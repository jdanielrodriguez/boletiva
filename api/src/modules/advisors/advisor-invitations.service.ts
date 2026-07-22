import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PromoterInvitationStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MailService } from '../../infra/mail/mail.service';
import { randomToken, sha256 } from '../../common/utils/crypto';

const TTL_DAYS = 14;
const MAX_EMAILS = 50;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_ROUNDS = 12;

/**
 * Invitación de ASESORES (T7). El admin invita por correo:
 *  - Usuario YA existe → el link CONFIRMA la subida a rol asesor (auth requerida).
 *  - Usuario NO existe → se crea el User (pending, sin password) y el link lleva a
 *    FIJAR CONTRASEÑA (sin auth; el token autentica) → queda asesor y activo.
 * Reusa el patrón de promoter-invitations (token hasheado, TTL, estados).
 */
@Injectable()
export class AdvisorInvitationsService {
  private readonly logger = new Logger(AdvisorInvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  private origin(): string {
    return (this.config.get<string[]>('cors.origins') ?? [])[0] ?? '';
  }

  /** (Admin) Crea invitaciones de asesor para uno o varios correos. */
  async create(rawEmails: string[], invitedById: string) {
    const emails = Array.from(new Set((rawEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean)));
    if (emails.length === 0) throw new BadRequestException('Indica al menos un correo');
    if (emails.length > MAX_EMAILS) throw new BadRequestException(`Máximo ${MAX_EMAILS} correos por lote`);
    for (const email of emails) {
      if (!EMAIL_RE.test(email)) throw new BadRequestException(`Correo inválido: ${email}`);
    }

    const invitations = [];
    for (const email of emails) {
      const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true, roles: true } });
      if (existing?.roles.includes(Role.advisor)) {
        throw new ConflictException(`El usuario ${email} ya es asesor`);
      }
      let createdUserId: string | null = null;
      if (!existing) {
        // Usuario NUEVO: se crea sin password ni verificación; fijará ambos con el link.
        const u = await this.prisma.user.create({
          data: {
            email,
            firstName: email.split('@')[0],
            roles: [Role.buyer],
            status: 'pending',
          },
          select: { id: true },
        });
        createdUserId = u.id;
      }
      const token = randomToken(24);
      const inv = await this.prisma.advisorInvitation.create({
        data: {
          email,
          tokenHash: sha256(token),
          invitedById,
          createdUserId,
          expiresAt: new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000),
        },
      });
      const path = createdUserId ? '/asesor/fijar-password' : '/asesor/confirmar';
      const url = `${this.origin()}${path}?token=${token}`;
      await this.sendEmail(email, url, !!createdUserId);
      invitations.push({ id: inv.id, email, token, url, isNewUser: !!createdUserId });
    }
    return { invitations };
  }

  private async sendEmail(email: string, url: string, isNew: boolean): Promise<void> {
    try {
      await this.mail.enqueueTemplated(email, 'Te invitaron como asesor de soporte — Boletiva', {
        title: 'Invitación de asesor',
        preheader: 'Únete al equipo de soporte de Boletiva.',
        bodyHtml: isNew
          ? `<p style="margin:0 0 12px 0;">Te invitamos a ser <strong>asesor de soporte</strong> en Boletiva. Haz clic para <strong>crear tu contraseña</strong> y activar tu cuenta.</p>`
          : `<p style="margin:0 0 12px 0;">Te invitamos a ser <strong>asesor de soporte</strong> en Boletiva. Haz clic para <strong>confirmar</strong> tu nuevo rol.</p>`,
        cta: { url, label: isNew ? 'Crear contraseña' : 'Confirmar rol de asesor' },
      }, { type: 'advisor_invite' });
    } catch (err) {
      this.logger.warn(`No se pudo enviar la invitación de asesor a ${email}: ${(err as Error).message}`);
    }
  }

  /** (Admin) Lista de invitaciones de asesor. */
  async list() {
    return this.prisma.advisorInvitation.findMany({
      select: {
        id: true,
        email: true,
        status: true,
        invitedById: true,
        acceptedByUserId: true,
        expiresAt: true,
        acceptedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Vista pública por token: correo + si requiere fijar contraseña (usuario nuevo). */
  async peek(token: string) {
    const inv = await this.findUsable(token);
    return { email: inv.email, needsPassword: inv.createdUserId != null, valid: true };
  }

  /** El usuario EXISTENTE (autenticado, email coincide) confirma → gana el rol asesor. */
  async acceptExisting(token: string, userId: string) {
    const inv = await this.findUsable(token);
    if (inv.createdUserId) {
      throw new BadRequestException('Esta invitación es para una cuenta nueva; usa el enlace para fijar contraseña');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.email.toLowerCase() !== inv.email.toLowerCase()) {
      throw new ForbiddenException('La invitación es para otro correo');
    }
    await this.grantAdvisor(user.id, user.roles);
    await this.markAccepted(inv.id, user.id);
    return { accepted: true };
  }

  /** El usuario NUEVO fija su contraseña → queda asesor y activo. */
  async setPassword(token: string, password: string) {
    const inv = await this.findUsable(token);
    if (!inv.createdUserId) {
      throw new BadRequestException('Esta invitación es para una cuenta existente; inicia sesión y confírmala');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: inv.createdUserId } });
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        status: 'active',
        emailVerifiedAt: new Date(),
        roles: this.withAdvisor(user.roles),
      },
    });
    await this.markAccepted(inv.id, user.id);
    return { ok: true };
  }

  private withAdvisor(roles: Role[]): Role[] {
    return roles.includes(Role.advisor) ? roles : [...roles, Role.advisor];
  }
  private async grantAdvisor(userId: string, roles: Role[]): Promise<void> {
    if (roles.includes(Role.advisor)) return;
    await this.prisma.user.update({ where: { id: userId }, data: { roles: this.withAdvisor(roles) } });
  }
  private async markAccepted(id: string, userId: string): Promise<void> {
    await this.prisma.advisorInvitation.update({
      where: { id },
      data: { status: PromoterInvitationStatus.accepted, acceptedByUserId: userId, acceptedAt: new Date() },
    });
  }

  private async findUsable(token: string) {
    if (!token) throw new NotFoundException('Invitación no encontrada');
    const inv = await this.prisma.advisorInvitation.findUnique({ where: { tokenHash: sha256(token) } });
    if (!inv || inv.status === PromoterInvitationStatus.revoked) {
      throw new NotFoundException('Invitación no encontrada o revocada');
    }
    if (inv.status === PromoterInvitationStatus.accepted) throw new ConflictException('La invitación ya fue utilizada');
    if (inv.expiresAt.getTime() < Date.now()) {
      if (inv.status !== PromoterInvitationStatus.expired) {
        await this.prisma.advisorInvitation.update({
          where: { id: inv.id },
          data: { status: PromoterInvitationStatus.expired },
        });
      }
      throw new BadRequestException('La invitación venció');
    }
    return inv;
  }
}
