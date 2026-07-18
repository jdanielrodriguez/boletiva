import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { PromoterInvitationStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MailService } from '../../infra/mail/mail.service';
import { randomToken, sha256 } from '../../common/utils/crypto';
import { PromotersService } from './promoters.service';

/** Días de validez de una invitación de promotor. */
const TTL_DAYS = 14;
/** Máximo de correos por lote (evita abuso). */
const MAX_EMAILS = 50;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Invitación de promotores por token (F4). Un admin o promotor aprobado invita por
 * correo; se genera una URL con token (se muestra una sola vez, se guarda hasheado).
 * El destinatario se registra con el email precargado y al aceptar queda
 * AUTO-APROBADO como promotor (se salta la autorización del admin).
 */
@Injectable()
export class PromoterInvitationsService {
  private readonly logger = new Logger(PromoterInvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly promoters: PromotersService,
    private readonly mail: MailService,
  ) {}

  private origin(): string {
    return (this.config.get<string[]>('cors.origins') ?? [])[0] ?? '';
  }

  private expiry(): Date {
    return new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);
  }

  /** Crea invitaciones para uno o varios correos. Devuelve las URLs (token una vez). */
  async create(rawEmails: string[], invitedById: string, isTestUser = false) {
    const emails = Array.from(
      new Set((rawEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean)),
    );
    if (emails.length === 0) throw new BadRequestException('Indica al menos un correo');
    if (emails.length > MAX_EMAILS) {
      throw new BadRequestException(`Máximo ${MAX_EMAILS} correos por lote`);
    }
    for (const email of emails) {
      if (!EMAIL_RE.test(email)) throw new BadRequestException(`Correo inválido: ${email}`);
    }

    const invitations = [];
    for (const email of emails) {
      const token = randomToken(24);
      const expiresAt = this.expiry();
      const inv = await this.prisma.promoterInvitation.create({
        data: { email, tokenHash: sha256(token), invitedById, expiresAt, isTestUser },
      });
      const url = `${this.origin()}/registro?token=${token}`;
      await this.sendInvitationEmail(email, url);
      invitations.push({
        id: inv.id,
        email,
        token,
        url,
        expiresAt: expiresAt.toISOString(),
      });
    }
    return { invitations };
  }

  /** Envía el correo de invitación con el enlace de registro (tolerante a fallos). */
  private async sendInvitationEmail(email: string, url: string): Promise<void> {
    try {
      await this.mail.enqueueTemplated(email, 'Te invitaron a ser promotor — Boletiva', {
        title: 'Te invitaron a ser promotor',
        preheader: 'Crea tu cuenta de promotor en Boletiva y empieza a vender.',
        bodyHtml: `<p style="margin:0 0 12px 0;">Te invitamos a unirte a <strong>Boletiva</strong> como promotor. Al registrarte con este enlace, tu cuenta quedará <strong>aprobada automáticamente</strong> para crear y publicar eventos.</p>
          <p class="pe-muted" style="margin:0;font-size:14px;color:#6b6b76;">El enlace vence en ${TTL_DAYS} días. Si no esperabas esta invitación, puedes ignorar este correo.</p>`,
        cta: { url, label: 'Crear mi cuenta de promotor' },
      });
    } catch (err) {
      this.logger.warn(`No se pudo enviar la invitación a ${email}: ${(err as Error).message}`);
    }
  }

  /** Lista invitaciones: admin ve todas; un promotor ve solo las suyas. */
  async list(requesterId: string, isAdmin: boolean) {
    return this.prisma.promoterInvitation.findMany({
      where: isAdmin ? {} : { invitedById: requesterId },
      select: {
        id: true,
        email: true,
        status: true,
        isTestUser: true,
        invitedById: true,
        acceptedByUserId: true,
        expiresAt: true,
        acceptedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Revoca una invitación pendiente (dueño o admin). */
  async revoke(id: string, requesterId: string, isAdmin: boolean) {
    const inv = await this.prisma.promoterInvitation.findUnique({ where: { id } });
    if (!inv || (!isAdmin && inv.invitedById !== requesterId)) {
      throw new NotFoundException('Invitación no encontrada'); // no filtra existencia (IDOR)
    }
    if (inv.status !== PromoterInvitationStatus.pending) {
      throw new ConflictException('La invitación ya no está pendiente');
    }
    const updated = await this.prisma.promoterInvitation.update({
      where: { id },
      data: { status: PromoterInvitationStatus.revoked },
    });
    return { id: updated.id, status: updated.status };
  }

  /** Vista pública para precargar el registro: valida el token y devuelve el email. */
  async peek(token: string) {
    const inv = await this.findUsable(token);
    return { email: inv.email, valid: true };
  }

  /**
   * Vista pública por token: además del correo, indica si YA existe una cuenta con
   * ese correo. El frontend decide: si existe → pedir iniciar sesión y aceptar
   * (activa el rol promotor sin registro); si no → mandar al registro precargado.
   */
  async peekByToken(token: string) {
    const inv = await this.findUsable(token);
    const user = await this.prisma.user.findUnique({
      where: { email: inv.email.toLowerCase() },
      select: { id: true },
    });
    return { email: inv.email, accountExists: !!user, valid: true };
  }

  /**
   * Acepta la invitación: el usuario autenticado (cuyo email debe coincidir) queda
   * AUTO-APROBADO como promotor. Marca la invitación como aceptada. Idempotente si
   * ya la aceptó el mismo usuario.
   */
  async accept(token: string, userId: string) {
    const inv = await this.findUsable(token);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.email.toLowerCase() !== inv.email.toLowerCase()) {
      throw new ForbiddenException('La invitación es para otro correo');
    }
    await this.prisma.promoterInvitation.update({
      where: { id: inv.id },
      data: {
        status: PromoterInvitationStatus.accepted,
        acceptedByUserId: userId,
        acceptedAt: new Date(),
      },
    });
    // Propaga la marca de usuario de prueba al User (anclaje a Sandbox).
    if (inv.isTestUser) {
      await this.prisma.user.update({ where: { id: userId }, data: { isTestUser: true } });
    }
    const promoter = await this.promoters.autoApprove(userId);
    return { accepted: true, promoter };
  }

  /** Busca una invitación por token: vigente y pendiente; marca expiradas al vuelo. */
  private async findUsable(token: string) {
    if (!token) throw new NotFoundException('Invitación no encontrada');
    const inv = await this.prisma.promoterInvitation.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (!inv || inv.status === PromoterInvitationStatus.revoked) {
      throw new NotFoundException('Invitación no encontrada o revocada');
    }
    if (inv.status === PromoterInvitationStatus.accepted) {
      throw new ConflictException('La invitación ya fue utilizada');
    }
    if (inv.expiresAt.getTime() < Date.now()) {
      if (inv.status !== PromoterInvitationStatus.expired) {
        await this.prisma.promoterInvitation.update({
          where: { id: inv.id },
          data: { status: PromoterInvitationStatus.expired },
        });
      }
      throw new BadRequestException('La invitación venció');
    }
    return inv;
  }
}
