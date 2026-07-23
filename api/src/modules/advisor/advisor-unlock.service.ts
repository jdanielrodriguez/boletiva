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

interface UnlockGrantedMailJob {
  advisorEmail: string;
  advisorName: string;
  expiresAt: string;
  minutes: number;
}

/** Minutos de la ventana de desbloqueo del asesor (configurable por env). */
const DEFAULT_WINDOW_MIN = 30;
/** Vida del ENLACE pendiente de aprobación: un correo viejo no debe seguir siendo válido. */
const PENDING_TOKEN_TTL_MIN = 30;

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

  /** Handler de la cola MAIL (compartida): avisa a los admins con el enlace de
   * aprobación, o al asesor cuando un admin le concede el desbloqueo (F3). */
  private async handleMail(name: string, data: unknown): Promise<void> {
    if (name === 'advisor-unlock-granted') return this.handleGrantedMail(data);
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
            `<p style="margin:0;font-size:14px;color:{{muted}};">Si no la reconoces, ignora este correo (no se abre ninguna ventana).</p>`,
          cta: { url: job.link, label: '🔓 Autorizar edición' },
        })
        .catch((e) => this.logger.warn(`No se pudo avisar a ${a.email}: ${(e as Error).message}`));
    }
  }

  /** Correo al ASESOR cuando un admin le concede el desbloqueo directamente (F3). */
  private async handleGrantedMail(data: unknown): Promise<void> {
    const job = data as UnlockGrantedMailJob;
    const who = escapeHtml(job.advisorName || 'asesor');
    await this.mail
      .sendTemplated(job.advisorEmail, '🔓 Desbloqueo concedido — Boletiva', {
        title: '¡Listo! Ya puedes editar 🎉',
        preheader: `Un administrador autorizó tu desbloqueo por ${job.minutes} minutos.`,
        bodyHtml:
          `<p style="margin:0 0 12px 0;">Hola <strong>${who}</strong>, un administrador ` +
          `autorizó tu <strong>ventana de desbloqueo</strong> para editar áreas de administración.</p>` +
          `<p style="margin:0;font-size:14px;color:{{muted}};">La ventana está activa por ` +
          `<strong>${job.minutes} minutos</strong>. Cuando termine, tendrás que solicitarla de nuevo.</p>`,
      })
      .catch((e) => this.logger.warn(`No se pudo avisar al asesor: ${(e as Error).message}`));
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
    // Base = URL del FRONTEND (primer CORS origin), igual que invitaciones/validadores.
    // Antes usaba `app.publicUrl` (vacío en dev) → el enlace salía RELATIVO y el cliente
    // de correo (MailHog :8026) le anteponía SU host. Ahora es absoluto al frontend.
    const base = (this.config.get<string[]>('cors.origins') ?? [])[0] ?? '';
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
    // TTL del enlace pendiente (QA): un correo de aprobación viejo (semanas/meses) NO debe
    // seguir siendo válido. Se rechaza y se limpia si superó la ventana de vida del token.
    if (Date.now() - unlock.createdAt.getTime() > PENDING_TOKEN_TTL_MIN * 60_000) {
      await this.prisma.advisorUnlock.delete({ where: { id: unlock.id } });
      throw new BadRequestException('El enlace de desbloqueo caducó; pide al asesor que lo solicite de nuevo');
    }
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

  /**
   * Estado de desbloqueo de TODOS los asesores con actividad, para el panel admin
   * (F3): un asesor aparece si tiene una solicitud PENDIENTE o una ventana APROBADA
   * vigente. Una sola consulta (server-side) → la tabla no hace N peticiones.
   */
  async listUnlockStates(): Promise<
    Array<{ advisorId: string; pending: boolean; requestedAt: Date | null; unlocked: boolean; expiresAt: Date | null }>
  > {
    const now = new Date();
    const rows = await this.prisma.advisorUnlock.findMany({
      where: { OR: [{ approved: false }, { approved: true, expiresAt: { gt: now } }] },
      orderBy: { createdAt: 'desc' },
    });
    const byAdvisor = new Map<
      string,
      { advisorId: string; pending: boolean; requestedAt: Date | null; unlocked: boolean; expiresAt: Date | null }
    >();
    for (const r of rows) {
      const cur =
        byAdvisor.get(r.advisorId) ??
        { advisorId: r.advisorId, pending: false, requestedAt: null, unlocked: false, expiresAt: null };
      if (!r.approved) {
        cur.pending = true;
        if (!cur.requestedAt || r.createdAt > cur.requestedAt) cur.requestedAt = r.createdAt;
      } else if (r.expiresAt && r.expiresAt > now) {
        cur.unlocked = true;
        if (!cur.expiresAt || r.expiresAt > cur.expiresAt) cur.expiresAt = r.expiresAt;
      }
      byAdvisor.set(r.advisorId, cur);
    }
    return [...byAdvisor.values()];
  }

  /**
   * El ADMIN concede el desbloqueo DIRECTAMENTE, sin el token del correo (F3): abre
   * la ventana y avisa al asesor. Vía paralela y AUDITADA al `approve` por enlace
   * (queda `approvedById`). Reutiliza la solicitud pendiente si existe. @AdminOnly.
   */
  async grant(advisorId: string, adminId: string) {
    const advisor = await this.prisma.user.findUnique({
      where: { id: advisorId },
      select: { id: true, email: true, firstName: true, roles: true },
    });
    if (!advisor || !advisor.roles.includes(Role.advisor)) {
      throw new NotFoundException('Asesor no encontrado');
    }
    const minutes = this.config.get<number>('advisor.unlockWindowMin') ?? DEFAULT_WINDOW_MIN;
    const expiresAt = new Date(Date.now() + minutes * 60_000);
    const pending = await this.prisma.advisorUnlock.findFirst({
      where: { advisorId, approved: false },
      orderBy: { createdAt: 'desc' },
    });
    if (pending) {
      await this.prisma.advisorUnlock.update({
        where: { id: pending.id },
        data: { approved: true, approvedById: adminId, approvedAt: new Date(), expiresAt },
      });
    } else {
      await this.prisma.advisorUnlock.create({
        data: {
          advisorId,
          tokenHash: sha256(randomToken(24)), // token aleatorio: no aprobable por enlace
          approved: true,
          approvedById: adminId,
          approvedAt: new Date(),
          expiresAt,
        },
      });
    }
    // Limpia cualquier otra solicitud pendiente del asesor (ya está desbloqueado).
    await this.prisma.advisorUnlock.deleteMany({ where: { advisorId, approved: false } });
    // Avisa al asesor (best-effort, cola MAIL → nunca bloquea).
    await this.queue.enqueue(QUEUES.MAIL, 'advisor-unlock-granted', {
      advisorEmail: advisor.email,
      advisorName: advisor.firstName ?? '',
      expiresAt: expiresAt.toISOString(),
      minutes,
    });
    return { granted: true, advisorId, expiresAt };
  }
}
