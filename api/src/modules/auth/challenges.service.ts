import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChallengePurpose } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MailService } from '../../infra/mail/mail.service';
import { randomOtp, randomToken, sha256 } from '../../common/utils/crypto';

const TTL_MS: Record<ChallengePurpose, number> = {
  email_verify: 24 * 60 * 60 * 1000, // 24 h
  passwordless: 15 * 60 * 1000, // 15 min
  twofa_email: 10 * 60 * 1000, // 10 min
  gateway_unlock: 10 * 60 * 1000, // 10 min (desbloqueo para agregar pasarela)
  event_edit_unlock: 10 * 60 * 1000, // 10 min (OTP para desbloquear edición de evento, admin)
};
const MAX_ATTEMPTS = 5;

@Injectable()
export class ChallengesService {
  private readonly logger = new Logger(ChallengesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  private origin(): string {
    return (this.config.get<string[]>('cors.origins') ?? [])[0] ?? '';
  }

  /** Crea un reto (código de 6 dígitos + magic link opcional) y lo envía por correo. */
  async issue(
    userId: string,
    email: string,
    purpose: ChallengePurpose,
    opts: { withMagicLink?: boolean } = {},
  ): Promise<void> {
    // Invalida retos previos no consumidos del mismo propósito.
    await this.prisma.authChallenge.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const code = randomOtp();
    const token = opts.withMagicLink ? randomToken() : undefined;
    await this.prisma.authChallenge.create({
      data: {
        userId,
        purpose,
        codeHash: sha256(code),
        tokenHash: token ? sha256(token) : null,
        expiresAt: new Date(Date.now() + TTL_MS[purpose]),
      },
    });
    await this.sendEmail(email, purpose, code, token);
  }

  /** Valida un código de 6 dígitos; consume el reto. Devuelve el userId. */
  async verifyCode(email: string, purpose: ChallengePurpose, code: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (!user) throw new BadRequestException('Código inválido o expirado');
    return this.consumeByCode(user.id, purpose, code);
  }

  async consumeByCode(userId: string, purpose: ChallengePurpose, code: string): Promise<string> {
    const ch = await this.prisma.authChallenge.findFirst({
      where: { userId, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!ch) throw new BadRequestException('Código inválido o expirado');
    if (ch.attempts >= MAX_ATTEMPTS) throw new BadRequestException('Demasiados intentos');
    if (ch.codeHash !== sha256(code)) {
      await this.prisma.authChallenge.update({
        where: { id: ch.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Código inválido o expirado');
    }
    await this.prisma.authChallenge.update({
      where: { id: ch.id },
      data: { consumedAt: new Date() },
    });
    return userId;
  }

  /** Valida un token de magic link; consume el reto. Devuelve el userId. */
  async verifyToken(purpose: ChallengePurpose, token: string): Promise<string> {
    const ch = await this.prisma.authChallenge.findFirst({
      where: { purpose, tokenHash: sha256(token), consumedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!ch) throw new BadRequestException('Enlace inválido o expirado');
    await this.prisma.authChallenge.update({
      where: { id: ch.id },
      data: { consumedAt: new Date() },
    });
    return ch.userId;
  }

  private async sendEmail(
    email: string,
    purpose: ChallengePurpose,
    code: string,
    token?: string,
  ): Promise<void> {
    const origin = this.origin();
    const templates: Record<ChallengePurpose, { subject: string; intro: string; path: string }> = {
      email_verify: {
        subject: 'Verifica tu correo — Boletiva',
        intro: 'Verifica tu correo para activar tu cuenta.',
        path: '/verify-email',
      },
      passwordless: {
        subject: 'Tu enlace de acceso — Boletiva',
        intro: 'Usa este enlace o código para iniciar sesión.',
        path: '/passwordless',
      },
      twofa_email: {
        subject: 'Tu código de verificación — Boletiva',
        intro: 'Código de verificación en dos pasos.',
        path: '/2fa',
      },
      gateway_unlock: {
        subject: 'Código para agregar una pasarela — Boletiva',
        intro: 'Confirma que autorizas agregar una nueva pasarela de pago.',
        path: '/configuracion',
      },
      event_edit_unlock: {
        subject: 'Código para editar un evento — Boletiva',
        intro: 'Confirma que autorizas editar este evento como administrador.',
        path: '/admin/eventos',
      },
    };
    const t = templates[purpose];
    const link = token ? `${origin}${t.path}?token=${token}` : '';
    const bodyHtml = `
      <p style="margin:0 0 14px 0;">${t.intro}</p>
      <p style="margin:0 0 6px 0;">Tu código de verificación:</p>
      <p style="margin:0;font-size:30px;font-weight:700;letter-spacing:8px;color:#7c3aed;">${code}</p>
      <p class="pe-muted" style="margin:14px 0 0 0;font-size:14px;color:#6b6b76;">Válido por poco tiempo. Si no lo solicitaste, ignora este correo.</p>`;
    try {
      await this.mail.enqueueTemplated(email, t.subject, {
        title: t.subject.replace(' — Boletiva', ''),
        preheader: t.intro,
        bodyHtml,
        bodyText: `${t.intro}\nTu código: ${code} (válido por poco tiempo).`,
        cta: link ? { url: link, label: 'Continuar' } : undefined,
      });
    } catch (err) {
      this.logger.warn(`No se pudo enviar (${purpose}) a ${email}: ${(err as Error).message}`);
    }
  }
}
