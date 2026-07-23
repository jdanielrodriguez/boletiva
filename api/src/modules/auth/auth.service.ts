import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MailService } from '../../infra/mail/mail.service';
import { escapeHtml, type RenderInput } from '../../infra/mail/email-template';
import { sha256, randomToken } from '../../common/utils/crypto';
import { TokensService, TokenPair } from './tokens.service';
import { ChallengesService } from './challenges.service';
import { DevicesService, DeviceContext } from './devices.service';
import { TwoFactorService } from './twofactor.service';
import { GoogleAuthService } from './google.service';
import { StorageService } from '../../infra/storage/storage.service';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
  SignupDto,
} from './dto/auth.dto';

const BCRYPT_ROUNDS = 12;
const RECOVERY_TTL_MS = 60 * 60 * 1000;
const PREAUTH_TTL_S = 300;

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  roles: User['roles'];
  status: User['status'];
  emailVerified: boolean;
  twoFactorMethod: User['twoFactorMethod'];
  language: string;
  themePref: string | null;
  emailNotificationsEnabled: boolean;
  /** Usuario de PRUEBA (invitado en modo test): sus eventos usan Sandbox, sin cargos reales. */
  isTestUser: boolean;
  /** Facturación (FEL): NIT, nombre fiscal y DPI (opcional). */
  nit: string | null;
  billingName: string | null;
  dpi: string | null;
  /** Tours de onboarding ya vistos (para no repetirlos). */
  toursSeen: string[];
  /** Plan del promotor (free/premium). */
  promoterTier: string;
}

export type LoginResult =
  | { status: 'ok'; user: PublicUser; tokens: TokenPair }
  | { status: '2fa_required'; method: User['twoFactorMethod']; preauthToken: string };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly challenges: ChallengesService,
    private readonly devices: DevicesService,
    private readonly twofactor: TwoFactorService,
    private readonly google: GoogleAuthService,
    private readonly storage: StorageService,
    private readonly rateLimit: RateLimitService,
  ) {}

  // Lockout de login por CUENTA (defensa contra fuerza bruta distribuida por muchas IPs;
  // el rate-limit por IP cubre el flood desde una sola). Ventana + máx. fallos.
  private static readonly LOGIN_LOCK_WINDOW_SEC = 900; // 15 min
  private static readonly LOGIN_MAX_FAILS = 10;
  private static readonly TWOFA_LOCK_WINDOW_SEC = 300; // 5 min
  private static readonly TWOFA_MAX_FAILS = 5;
  private static readonly TWOFA_RESEND_COOLDOWN_SEC = 60; // 1 reenvío por MINUTO
  private static readonly TWOFA_MAX_RESENDS = 5; // tope de reenvíos por ventana
  private static readonly TWOFA_RESEND_WINDOW_SEC = 900; // ventana del tope (15 min)

  private async toPublic(user: User): Promise<PublicUser> {
    // La foto de perfil se firma al leer (patrón event-media): si hay `avatarKey`
    // (foto subida) se genera una URL firmada; si no, se usa `avatarUrl` (externa).
    const avatarUrl = user.avatarKey
      ? await this.storage.signedGetUrl(user.avatarKey, 6 * 60 * 60)
      : user.avatarUrl;
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      avatarUrl,
      roles: user.roles,
      status: user.status,
      emailVerified: user.emailVerifiedAt != null,
      twoFactorMethod: user.twoFactorMethod,
      language: user.language,
      themePref: user.themePref,
      emailNotificationsEnabled: user.emailNotificationsEnabled,
      isTestUser: user.isTestUser,
      nit: user.nit,
      billingName: user.billingName,
      dpi: user.dpi,
      toursSeen: user.toursSeen,
      promoterTier: user.promoterTier,
    };
  }

  // ---- Registro / login por contraseña ------------------------------------

  async signup(
    dto: SignupDto,
    ctx: DeviceContext,
  ): Promise<{ pending: true } | { user: PublicUser; tokens: TokenPair }> {
    const email = dto.email.toLowerCase().trim();
    // Anti-enumeración (M-01): si el correo YA existe NO devolvemos 409 (que revelaría la
    // existencia de la cuenta a un atacante que itera correos). En su lugar enviamos un
    // correo de cortesía ("ya tienes una cuenta") y devolvemos una respuesta genérica
    // `pending` (202) — sin sesión, sin crear nada. El flujo de alta real (correo nuevo)
    // sigue devolviendo 201 + tokens.
    if (await this.prisma.user.findUnique({ where: { email } })) {
      await this.sendAlreadyRegisteredEmail(email);
      return { pending: true };
    }
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        roles: ['buyer'],
      },
    });
    // Cuenta sin verificar: se envía el correo de verificación (código + link).
    await this.challenges.issue(user.id, user.email, 'email_verify', { withMagicLink: true });
    await this.devices.touch(user.id, ctx);
    const tokens = await this.tokens.issuePair(user, ctx);
    return { user: await this.toPublic(user), tokens };
  }

  async login(dto: LoginDto, ctx: DeviceContext): Promise<LoginResult> {
    const email = dto.email.toLowerCase().trim();
    // Lockout por (CUENTA + IP) — QA auth-H5: si fuera solo por email, cualquiera podría
    // BLOQUEAR una cuenta ajena a propósito (DoS) fallando el login. Al ligarlo también a la
    // IP, el bloqueo afecta solo al origen abusivo; la víctima (otra IP) sigue entrando. La
    // fuerza bruta distribuida la contienen el rate-limit por IP del endpoint + captcha + 2FA.
    const failKey = `login-fail:${email}:${ctx.ip ?? 'unknown'}`;
    if ((await this.rateLimit.count(failKey)) >= AuthService.LOGIN_MAX_FAILS) {
      throw new HttpException(
        'Demasiados intentos fallidos. Espera unos minutos o restablece tu contraseña.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = user?.passwordHash && (await bcrypt.compare(dto.password, user.passwordHash));
    if (!user || !ok) {
      await this.rateLimit.register(failKey, AuthService.LOGIN_LOCK_WINDOW_SEC);
      throw new UnauthorizedException('Credenciales inválidas');
    }
    if (user.status !== 'active') throw new UnauthorizedException('Cuenta inactiva');
    // Login válido → resetea el contador de fallos de esta cuenta.
    await this.rateLimit.clear(failKey);

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const { device } = await this.devices.touch(user.id, ctx);

    // Email sin verificar: insistir con el correo de verificación; no hay 2FA aún.
    if (!user.emailVerifiedAt) {
      await this.challenges.issue(user.id, user.email, 'email_verify', { withMagicLink: true });
      const tokens = await this.tokens.issuePair(user, ctx);
      return { status: 'ok', user: await this.toPublic(user), tokens };
    }

    // Email verificado: 2FA obligatorio en dispositivos no confiables.
    // El aviso de "nuevo dispositivo" se envía DESPUÉS de validar el 2FA (en
    // verifyTwoFactor), no aquí: no queremos alertar de un intento aún sin autenticar.
    // Confiamos SOLO si hay id estable (header/cookie) Y el dispositivo está marcado. Un
    // login SIN X-Device-Id (o legacy confiado por UA) exige 2FA siempre → cierra el salto
    // de 2FA por User-Agent reproducible.
    if (!this.devices.hasStableId(ctx) || !this.devices.isTrusted(device)) {
      await this.twofactor.startChallenge(user);
      return {
        status: '2fa_required',
        method: user.twoFactorMethod,
        preauthToken: this.signPreauth(user.id),
      };
    }

    const tokens = await this.tokens.issuePair(user, ctx);
    return { status: 'ok', user: await this.toPublic(user), tokens };
  }

  /**
   * Reenvía el código del segundo factor (FU9). Solo aplica al método EMAIL (TOTP no
   * "reenvía": el código lo genera la app). Cooldown por usuario para evitar spam de
   * correos. Devuelve el método para que el frontend ajuste el mensaje.
   */
  async resendTwoFactor(preauthToken: string): Promise<{ method: User['twoFactorMethod']; resent: boolean }> {
    const userId = this.verifyPreauth(preauthToken);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (user.twoFactorMethod !== 'email') {
      return { method: user.twoFactorMethod, resent: false }; // TOTP: nada que reenviar
    }
    // Tope TOTAL de reenvíos por ventana (evita spam de OTP): máximo 5; superado →
    // se bloquea y hay que reiniciar el login.
    const totalKey = `2fa-resend-total:${user.id}`;
    if ((await this.rateLimit.count(totalKey)) >= AuthService.TWOFA_MAX_RESENDS) {
      throw new HttpException(
        'Alcanzaste el máximo de reenvíos. Vuelve a iniciar sesión para pedir un código nuevo.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    // Cooldown: 1 reenvío por MINUTO.
    const key = `2fa-resend:${user.id}`;
    if ((await this.rateLimit.count(key)) >= 1) {
      throw new HttpException(
        'Espera un minuto antes de pedir otro código.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.rateLimit.register(key, AuthService.TWOFA_RESEND_COOLDOWN_SEC);
    await this.rateLimit.register(totalKey, AuthService.TWOFA_RESEND_WINDOW_SEC);
    await this.twofactor.startChallenge(user);
    return { method: user.twoFactorMethod, resent: true };
  }

  async verifyTwoFactor(preauthToken: string, code: string, ctx: DeviceContext) {
    const userId = this.verifyPreauth(preauthToken);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    // El 2FA solo se exige en dispositivos NO confiables; si el código es válido,
    // este dispositivo se está confiando ahora → es el momento correcto de avisar
    // del "nuevo inicio de sesión" (ya autenticado, no un mero intento).
    const wasTrusted = await this.devices.isKnownTrusted(user.id, ctx);
    // Cap de intentos del segundo factor (defensa de fuerza bruta del código, sobre todo
    // TOTP, cuyo verificador no lleva contador propio). 5 fallos → bloquea por la ventana.
    const failKey = `2fa-fail:${user.id}`;
    if ((await this.rateLimit.count(failKey)) >= AuthService.TWOFA_MAX_FAILS) {
      throw new HttpException(
        'Demasiados intentos del segundo factor. Vuelve a iniciar sesión.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    try {
      await this.twofactor.verify(user, code); // lanza si el código es inválido → no se avisa
    } catch (e) {
      await this.rateLimit.register(failKey, AuthService.TWOFA_LOCK_WINDOW_SEC);
      throw e;
    }
    await this.rateLimit.clear(failKey);
    await this.devices.trust(user.id, ctx);
    if (!wasTrusted) await this.sendNewDeviceAlert(user, ctx);
    const tokens = await this.tokens.issuePair(user, ctx);
    return { status: 'ok' as const, user: await this.toPublic(user), tokens };
  }

  // ---- Verificación de correo ---------------------------------------------

  async verifyEmailByCode(email: string, code: string, ctx: DeviceContext) {
    const userId = await this.challenges.verifyCode(email, 'email_verify', code);
    return this.markEmailVerified(userId, ctx);
  }

  async verifyEmailByToken(token: string, ctx: DeviceContext) {
    const userId = await this.challenges.verifyToken('email_verify', token);
    return this.markEmailVerified(userId, ctx);
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (!user || user.emailVerifiedAt) return; // no revela estado
    await this.challenges.issue(user.id, user.email, 'email_verify', { withMagicLink: true });
  }

  private async markEmailVerified(userId: string, ctx: DeviceContext): Promise<PublicUser> {
    // ¿Ya era confiable este dispositivo? (para decidir si avisamos de "nuevo dispositivo").
    const wasTrusted = await this.devices.isKnownTrusted(userId, ctx);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });
    // Validar el correo con el código/enlace prueba la POSESIÓN del buzón → factor
    // suficiente para CONFIAR este dispositivo. Así, tras verificar, un logout+login
    // desde el MISMO navegador ya no vuelve a pedir el 2FA (identidad estable por
    // `X-Device-Id`). Se avisa del nuevo dispositivo la primera vez (como en 2FA).
    await this.devices.trust(user.id, ctx);
    if (!wasTrusted) await this.sendNewDeviceAlert(user, ctx);
    return await this.toPublic(user);
  }

  // ---- Passwordless (magic link + código) ---------------------------------

  /** Solicita acceso sin contraseña; crea la cuenta si no existe. */
  async passwordlessRequest(email: string, firstName: string | undefined): Promise<void> {
    const normalized = email.toLowerCase().trim();
    let user = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (!user) {
      user = await this.prisma.user.create({
        data: { email: normalized, firstName: firstName ?? 'Invitado', roles: ['buyer'] },
      });
    }
    await this.challenges.issue(user.id, user.email, 'passwordless', { withMagicLink: true });
  }

  async passwordlessVerifyCode(email: string, code: string, ctx: DeviceContext) {
    const userId = await this.challenges.verifyCode(email, 'passwordless', code);
    return this.completePasswordless(userId, ctx);
  }

  async passwordlessVerifyToken(token: string, ctx: DeviceContext) {
    const userId = await this.challenges.verifyToken('passwordless', token);
    return this.completePasswordless(userId, ctx);
  }

  // Acceder al correo demuestra su posesión: verifica el email y confía el dispositivo.
  private async completePasswordless(userId: string, ctx: DeviceContext) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        emailVerifiedAt: (await this.notYetVerified(userId)) ? new Date() : undefined,
        lastLoginAt: new Date(),
      },
    });
    await this.devices.trust(user.id, ctx);
    const tokens = await this.tokens.issuePair(user, ctx);
    return { status: 'ok' as const, user: await this.toPublic(user), tokens };
  }

  private async notYetVerified(userId: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });
    return u?.emailVerifiedAt == null;
  }

  // ---- Google OAuth -------------------------------------------------------

  async googleLogin(idToken: string, ctx: DeviceContext) {
    const profile = await this.google.verify(idToken);
    let user = await this.prisma.user.findUnique({ where: { email: profile.email } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: profile.email,
          firstName: profile.firstName,
          lastName: profile.lastName,
          avatarUrl: profile.picture,
          emailVerifiedAt: new Date(), // Google ya verificó el correo
          roles: ['buyer'],
        },
      });
    } else if (!user.emailVerifiedAt) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });
    }
    await this.prisma.oAuthAccount.upsert({
      where: {
        provider_providerAccountId: {
          provider: 'google',
          providerAccountId: profile.providerAccountId,
        },
      },
      update: {},
      create: { userId: user.id, provider: 'google', providerAccountId: profile.providerAccountId },
    });
    await this.devices.trust(user.id, ctx); // Google es un factor fuerte
    const tokens = await this.tokens.issuePair(user, ctx);
    return { status: 'ok' as const, user: await this.toPublic(user), tokens };
  }

  get googleEnabled(): boolean {
    return this.google.enabled;
  }

  // ---- Sesión / cuenta ----------------------------------------------------

  refresh(refreshToken: string, ctx: DeviceContext): Promise<TokenPair> {
    return this.tokens.rotate(refreshToken, ctx);
  }

  logout(refreshToken: string): Promise<void> {
    return this.tokens.revoke(refreshToken);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return await this.toPublic(user);
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return;
    const raw = randomToken();
    await this.prisma.passwordRecovery.create({
      data: {
        userId: user.id,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + RECOVERY_TTL_MS),
      },
    });
    const origin = (this.config.get<string[]>('cors.origins') ?? [])[0] ?? '';
    await this.safeSend(user.email, 'Recupera tu contraseña — Boletiva', {
      title: 'Recupera tu contraseña',
      preheader: 'Restablece la contraseña de tu cuenta en Boletiva.',
      bodyHtml: `<p style="margin:0 0 12px 0;">Recibimos una solicitud para restablecer tu contraseña. El enlace es válido por 1 hora.</p>
        <p class="pe-muted" style="margin:0;font-size:14px;color:{{muted}};">Si no fuiste tú, ignora este correo: tu contraseña no cambiará.</p>`,
      cta: { url: `${origin}/reset-password?token=${raw}`, label: 'Restablecer contraseña' },
    });
  }

  /**
   * Correo de cortesía cuando alguien intenta registrarse con un correo YA existente
   * (M-01): en vez de revelar "el correo ya está registrado" por HTTP, avisamos por
   * correo al dueño real de la cuenta con opciones de iniciar sesión o recuperar la
   * contraseña. Best-effort (no bloquea ni lanza).
   */
  private async sendAlreadyRegisteredEmail(email: string): Promise<void> {
    const origin = (this.config.get<string[]>('cors.origins') ?? [])[0] ?? '';
    await this.safeSend(email, 'Sobre tu cuenta en Boletiva', {
      title: 'Ya tienes una cuenta',
      preheader: 'Intentaron registrar este correo, pero ya tiene una cuenta en Boletiva.',
      bodyHtml: `<p style="margin:0 0 12px 0;">Recibimos un intento de registro con este correo, pero <strong>ya tienes una cuenta</strong> en Boletiva. No creamos una nueva.</p>
        <p style="margin:0 0 12px 0;">Si fuiste tú, inicia sesión normalmente. Si no recuerdas tu contraseña, puedes restablecerla.</p>
        <p class="pe-muted" style="margin:0;font-size:14px;color:{{muted}};">Si no fuiste tú, puedes ignorar este correo: tu cuenta sigue protegida.</p>`,
      cta: { url: `${origin}/login`, label: 'Iniciar sesión' },
    });
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const recovery = await this.prisma.passwordRecovery.findUnique({
      where: { tokenHash: sha256(dto.token) },
    });
    if (!recovery || recovery.usedAt || recovery.expiresAt < new Date()) {
      throw new BadRequestException('Token de recuperación inválido o expirado');
    }
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: recovery.userId }, data: { passwordHash } }),
      this.prisma.passwordRecovery.update({
        where: { id: recovery.id },
        data: { usedAt: new Date() },
      }),
    ]);
    await this.tokens.revokeAllForUser(recovery.userId);
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash || !(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException('La contraseña actual es incorrecta');
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.tokens.revokeAllForUser(userId);
  }

  // ---- Helpers ------------------------------------------------------------

  private signPreauth(userId: string): string {
    return this.jwt.sign(
      { sub: userId, typ: '2fa' },
      { secret: this.config.getOrThrow<string>('jwt.accessSecret'), expiresIn: PREAUTH_TTL_S },
    );
  }

  private verifyPreauth(token: string): string {
    try {
      const payload = this.jwt.verify<{ sub: string; typ: string }>(token, {
        secret: this.config.getOrThrow<string>('jwt.accessSecret'),
      });
      if (payload.typ !== '2fa') throw new Error('bad type');
      return payload.sub;
    } catch {
      throw new UnauthorizedException('Sesión de verificación inválida o expirada');
    }
  }

  private async sendNewDeviceAlert(user: User, ctx: DeviceContext): Promise<void> {
    const ip = escapeHtml(ctx.ip ?? 'desconocida');
    const ua = escapeHtml(ctx.userAgent ?? 'dispositivo desconocido');
    await this.safeSend(user.email, 'Nuevo inicio de sesión — Boletiva', {
      title: 'Nuevo inicio de sesión',
      preheader: 'Detectamos un acceso desde un nuevo dispositivo.',
      bodyHtml: `<p style="margin:0 0 12px 0;">Hola ${escapeHtml(user.firstName)}, detectamos un inicio de sesión desde un nuevo dispositivo.</p>
        <p style="margin:0 0 4px 0;"><strong>IP:</strong> ${ip}</p>
        <p style="margin:0 0 12px 0;"><strong>Dispositivo:</strong> ${ua}</p>
        <p class="pe-muted" style="margin:0;font-size:14px;color:{{muted}};">Si no fuiste tú, cambia tu contraseña de inmediato.</p>`,
    });
  }

  private async safeSend(to: string, subject: string, input: RenderInput): Promise<void> {
    try {
      await this.mail.enqueueTemplated(to, subject, input);
    } catch (err) {
      this.logger.warn(`No se pudo enviar correo a ${to}: ${(err as Error).message}`);
    }
  }
}
