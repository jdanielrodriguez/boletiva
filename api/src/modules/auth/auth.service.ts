import {
  BadRequestException,
  ConflictException,
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
  ) {}

  private toPublic(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      roles: user.roles,
      status: user.status,
      emailVerified: user.emailVerifiedAt != null,
      twoFactorMethod: user.twoFactorMethod,
    };
  }

  // ---- Registro / login por contraseña ------------------------------------

  async signup(
    dto: SignupDto,
    ctx: DeviceContext,
  ): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const email = dto.email.toLowerCase().trim();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('El correo ya está registrado');
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
    return { user: this.toPublic(user), tokens };
  }

  async login(dto: LoginDto, ctx: DeviceContext): Promise<LoginResult> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = user?.passwordHash && (await bcrypt.compare(dto.password, user.passwordHash));
    if (!user || !ok) throw new UnauthorizedException('Credenciales inválidas');
    if (user.status !== 'active') throw new UnauthorizedException('Cuenta inactiva');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const { device, isNew } = await this.devices.touch(user.id, ctx);

    // Email sin verificar: insistir con el correo de verificación; no hay 2FA aún.
    if (!user.emailVerifiedAt) {
      await this.challenges.issue(user.id, user.email, 'email_verify', { withMagicLink: true });
      const tokens = await this.tokens.issuePair(user, ctx);
      return { status: 'ok', user: this.toPublic(user), tokens };
    }

    // Email verificado: 2FA obligatorio en dispositivos no confiables.
    if (!this.devices.isTrusted(device)) {
      if (isNew) await this.sendNewDeviceAlert(user, ctx);
      await this.twofactor.startChallenge(user);
      return {
        status: '2fa_required',
        method: user.twoFactorMethod,
        preauthToken: this.signPreauth(user.id),
      };
    }

    const tokens = await this.tokens.issuePair(user, ctx);
    return { status: 'ok', user: this.toPublic(user), tokens };
  }

  async verifyTwoFactor(preauthToken: string, code: string, ctx: DeviceContext) {
    const userId = this.verifyPreauth(preauthToken);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    await this.twofactor.verify(user, code);
    await this.devices.trust(user.id, ctx);
    const tokens = await this.tokens.issuePair(user, ctx);
    return { status: 'ok' as const, user: this.toPublic(user), tokens };
  }

  // ---- Verificación de correo ---------------------------------------------

  async verifyEmailByCode(email: string, code: string) {
    const userId = await this.challenges.verifyCode(email, 'email_verify', code);
    return this.markEmailVerified(userId);
  }

  async verifyEmailByToken(token: string) {
    const userId = await this.challenges.verifyToken('email_verify', token);
    return this.markEmailVerified(userId);
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (!user || user.emailVerifiedAt) return; // no revela estado
    await this.challenges.issue(user.id, user.email, 'email_verify', { withMagicLink: true });
  }

  private async markEmailVerified(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });
    return this.toPublic(user);
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
    return { status: 'ok' as const, user: this.toPublic(user), tokens };
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
    return { status: 'ok' as const, user: this.toPublic(user), tokens };
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
    return this.toPublic(user);
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
    await this.safeSend(user.email, 'Recupera tu contraseña — Pasa Eventos', {
      title: 'Recupera tu contraseña',
      preheader: 'Restablece la contraseña de tu cuenta en Pasa Eventos.',
      bodyHtml: `<p style="margin:0 0 12px 0;">Recibimos una solicitud para restablecer tu contraseña. El enlace es válido por 1 hora.</p>
        <p class="pe-muted" style="margin:0;font-size:14px;color:#6b6b76;">Si no fuiste tú, ignora este correo: tu contraseña no cambiará.</p>`,
      cta: { url: `${origin}/reset-password?token=${raw}`, label: 'Restablecer contraseña' },
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
    await this.safeSend(user.email, 'Nuevo inicio de sesión — Pasa Eventos', {
      title: 'Nuevo inicio de sesión',
      preheader: 'Detectamos un acceso desde un nuevo dispositivo.',
      bodyHtml: `<p style="margin:0 0 12px 0;">Hola ${escapeHtml(user.firstName)}, detectamos un inicio de sesión desde un nuevo dispositivo.</p>
        <p style="margin:0 0 4px 0;"><strong>IP:</strong> ${ip}</p>
        <p style="margin:0 0 12px 0;"><strong>Dispositivo:</strong> ${ua}</p>
        <p class="pe-muted" style="margin:0;font-size:14px;color:#6b6b76;">Si no fuiste tú, cambia tu contraseña de inmediato.</p>`,
    });
  }

  private async safeSend(to: string, subject: string, input: RenderInput): Promise<void> {
    try {
      await this.mail.sendTemplated(to, subject, input);
    } catch (err) {
      this.logger.warn(`No se pudo enviar correo a ${to}: ${(err as Error).message}`);
    }
  }
}
