import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService } from '../../infra/queue/queue.service';
import { QUEUES } from '../../infra/queue/queue.constants';
import { MailService } from '../../infra/mail/mail.service';
import { randomToken, sha256 } from '../../common/utils/crypto';
import { escapeHtml } from '../../common/utils/html';

interface UnlockMailJob {
  advisorEmail: string;
  advisorName: string;
  link: string;
}

/** Minutos de la ventana de desbloqueo del asesor (configurable por env). */
const DEFAULT_WINDOW_MIN = 30;

/**
 * Desbloqueo del ASESOR (B2). Un asesor hereda los permisos del admin pero, para
 * MUTAR (salvo que `advisor.lock_enabled=false`), necesita una ventana de tiempo
 * aprobada por un ADMIN vía un ENLACE que recibe por correo. Flujo:
 *   request(advisor) → crea unlock pendiente + token (hash en BD) → email al admin
 *   approve(token)  → el admin (autenticado) abre la ventana (expiresAt = now + N min)
 *   isUnlocked(advisor) → ¿hay ventana aprobada vigente?
 */
@Injectable()
export class AdvisorUnlockService implements OnModuleInit {
  private readonly logger = new Logger(AdvisorUnlockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  onModuleInit(): void {
    this.queue.registerHandler(QUEUES.MAIL, (name, data) => this.handleMail(name, data));
  }

  /** Handler de la cola MAIL (compartida): avisa a los admins con el enlace de aprobación. */
  private async handleMail(name: string, data: unknown): Promise<void> {
    if (name !== 'advisor-unlock-request') return;
    const job = data as UnlockMailJob;
    const admins = await this.prisma.user.findMany({
      where: { roles: { has: Role.admin }, status: 'active' },
      select: { email: true },
    });
    const who = escapeHtml(job.advisorName || job.advisorEmail);
    const subject = '🔓 Un asesor pide autorización para editar — Boletiva';
    // Plantilla con marca + tema (resuelve la franja según la config) + CTA botón
    // (con enlace de respaldo debajo). Envío directo: ya estamos en el worker de la cola.
    for (const a of admins) {
      await this.mail
        .sendTemplated(a.email, subject, {
          title: 'Solicitud de desbloqueo de asesor',
          preheader: `${who} pide permiso para editar áreas de administración.`,
          bodyHtml:
            `<p style="margin:0 0 12px 0;">El asesor <strong>${who}</strong> (${escapeHtml(job.advisorEmail)}) ` +
            `solicitó una <strong>ventana de desbloqueo</strong> para editar áreas de administración.</p>` +
            `<p style="margin:0 0 12px 0;">Si reconoces la solicitud, autorízala: abrirá una ventana de tiempo limitada.</p>` +
            `<p style="margin:0;font-size:14px;color:#8a8a94;">Si no la reconoces, ignora este correo (no se abre ninguna ventana).</p>`,
          cta: { url: job.link, label: '🔓 Autorizar edición' },
        })
        .catch((e) => this.logger.warn(`No se pudo avisar a ${a.email}: ${(e as Error).message}`));
    }
  }

  /** ¿Está activada la exigencia de desbloqueo? (setting; default true). */
  async lockEnabled(): Promise<boolean> {
    const s = await this.prisma.setting.findUnique({ where: { key: 'advisor.lock_enabled' } });
    if (s == null) return true;
    return s.value === true;
  }

  /** El asesor solicita desbloqueo: crea el pendiente y encola el correo con el enlace al admin. */
  async request(advisorId: string): Promise<{ requested: boolean; devToken?: string }> {
    // Un solo pendiente a la vez: limpia los previos sin aprobar de este asesor.
    await this.prisma.advisorUnlock.deleteMany({ where: { advisorId, approved: false } });
    const token = randomToken(24);
    const unlock = await this.prisma.advisorUnlock.create({
      data: { advisorId, tokenHash: sha256(token) },
    });
    const advisor = await this.prisma.user.findUnique({
      where: { id: advisorId },
      select: { email: true, firstName: true },
    });
    const base = this.config.get<string>('app.publicUrl') ?? '';
    const link = `${base}/admin/asesor-desbloqueo?token=${token}`;
    // Aviso a TODOS los admins (best-effort, cola MAIL → nunca bloquea).
    await this.queue.enqueue(QUEUES.MAIL, 'advisor-unlock-request', {
      unlockId: unlock.id,
      advisorEmail: advisor?.email ?? '',
      advisorName: advisor?.firstName ?? '',
      link,
    });
    // Fuera de producción, devolvemos el token (el admin aprueba con él) para poder
    // ejercitar el flujo en dev/test sin depender del correo. En prod NUNCA se expone.
    const isProd = this.config.get<boolean>('isProd');
    return isProd ? { requested: true } : { requested: true, devToken: token };
  }

  /** El admin aprueba (desde el enlace): abre la ventana. Token inválido → 404; ya usado → 400. */
  async approve(token: string, adminId: string) {
    const unlock = await this.prisma.advisorUnlock.findUnique({ where: { tokenHash: sha256(token) } });
    if (!unlock) throw new NotFoundException('Enlace de desbloqueo inválido');
    if (unlock.approved) throw new BadRequestException('Este desbloqueo ya fue aprobado');
    const minutes = this.config.get<number>('advisor.unlockWindowMin') ?? DEFAULT_WINDOW_MIN;
    const updated = await this.prisma.advisorUnlock.update({
      where: { id: unlock.id },
      data: { approved: true, approvedById: adminId, approvedAt: new Date(), expiresAt: new Date(Date.now() + minutes * 60_000) },
    });
    return { approved: true, advisorId: updated.advisorId, expiresAt: updated.expiresAt };
  }

  /** ¿El asesor tiene una ventana aprobada vigente? */
  async isUnlocked(advisorId: string): Promise<boolean> {
    const active = await this.prisma.advisorUnlock.findFirst({
      where: { advisorId, approved: true, expiresAt: { gt: new Date() } },
    });
    return !!active;
  }

  /** Estado del desbloqueo del asesor autenticado (para la UI). */
  async status(advisorId: string) {
    const lockEnabled = await this.lockEnabled();
    const active = await this.prisma.advisorUnlock.findFirst({
      where: { advisorId, approved: true, expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: 'desc' },
    });
    const pending = await this.prisma.advisorUnlock.findFirst({
      where: { advisorId, approved: false },
      orderBy: { createdAt: 'desc' },
    });
    return {
      lockEnabled,
      unlocked: !!active || !lockEnabled,
      expiresAt: active?.expiresAt ?? null,
      pending: !!pending,
    };
  }
}
