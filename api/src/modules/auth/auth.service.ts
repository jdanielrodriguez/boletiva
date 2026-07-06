import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MailService } from '../../infra/mail/mail.service';
import { TokensService, TokenPair } from './tokens.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
  SignupDto,
} from './dto/auth.dto';

const BCRYPT_ROUNDS = 12;
const RECOVERY_TTL_MS = 60 * 60 * 1000; // 1 hora

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  roles: User['roles'];
  status: User['status'];
}

interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
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
    };
  }

  async signup(
    dto: SignupDto,
    meta: SessionMeta,
  ): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const email = dto.email.toLowerCase().trim();
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new ConflictException('El correo ya está registrado');

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

    const tokens = await this.tokens.issuePair(user, meta);
    await this.safeSendWelcome(user);
    return { user: this.toPublic(user), tokens };
  }

  async login(dto: LoginDto, meta: SessionMeta): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = user && (await bcrypt.compare(dto.password, user.passwordHash));
    if (!user || !ok) throw new UnauthorizedException('Credenciales inválidas');
    if (user.status !== 'active') throw new UnauthorizedException('Cuenta inactiva');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    const tokens = await this.tokens.issuePair(user, meta);
    return { user: this.toPublic(user), tokens };
  }

  refresh(refreshToken: string, meta: SessionMeta): Promise<TokenPair> {
    return this.tokens.rotate(refreshToken, meta);
  }

  logout(refreshToken: string): Promise<void> {
    return this.tokens.revoke(refreshToken);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.toPublic(user);
  }

  /** No revela si el correo existe (anti-enumeración). */
  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return;

    const raw = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(raw).digest('hex');
    await this.prisma.passwordRecovery.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + RECOVERY_TTL_MS) },
    });

    const origin = (this.config.get<string[]>('cors.origins') ?? [])[0] ?? '';
    const link = `${origin}/reset-password?token=${raw}`;
    await this.safeSend(
      user.email,
      'Recupera tu contraseña',
      `
      <p>Recibimos una solicitud para restablecer tu contraseña.</p>
      <p><a href="${link}">Restablecer contraseña</a> (válido 1 hora).</p>
      <p>Si no fuiste tú, ignora este correo.</p>`,
    );
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    const recovery = await this.prisma.passwordRecovery.findUnique({ where: { tokenHash } });
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
    await this.tokens.revokeAllForUser(recovery.userId); // cierra sesiones existentes
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException('La contraseña actual es incorrecta');
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.tokens.revokeAllForUser(userId);
  }

  private async safeSendWelcome(user: User): Promise<void> {
    await this.safeSend(
      user.email,
      '¡Bienvenido a Pasa Eventos!',
      `<p>Hola ${user.firstName}, tu cuenta fue creada con éxito.</p>`,
    );
  }

  // El correo no debe tumbar el flujo de auth si el SMTP falla.
  private async safeSend(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.mail.send({ to, subject, html });
    } catch (err) {
      this.logger.warn(`No se pudo enviar correo a ${to}: ${(err as Error).message}`);
    }
  }
}
