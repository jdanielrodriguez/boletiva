import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService } from '../../infra/queue/queue.service';
import { QUEUES } from '../../infra/queue/queue.constants';
import { KeysetQuery, keysetResult, keysetTake } from '../../common/utils/pagination';
import { AuditService } from '../audit/audit.service';
import { NotificationsGateway } from './notifications.gateway';
import { CHANNEL_DEFAULT, NotificationChannel, NotificationType } from './notification.types';

export interface EmitInput {
  type: string;
  title: string;
  body?: string;
  payload?: Prisma.InputJsonValue;
  resourceType?: string;
  resourceId?: string;
  /** Correo asociado (asunto/html) si el canal email está habilitado para el usuario. */
  email?: { subject: string; html: string };
}

/**
 * Notificaciones (T5). Punto ÚNICO de emisión: escribe la notificación in-app,
 * la empuja por socket en vivo y encola el correo si el usuario lo tiene activado.
 * `emit*` NUNCA lanza (una notificación fallida no debe tumbar el flujo disparador,
 * p.ej. una aprobación de promotor ya realizada). @Global: cualquier módulo la inyecta.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
  ) {}

  /**
   * (Admin) Envía una notificación MANUAL a un promotor concreto o a TODOS los
   * promotores activos. Auditado (no-repudio del envío). Devuelve a cuántos llegó.
   */
  async adminSend(
    actorId: string,
    input: { promoterId?: string; all?: boolean; title: string; body: string },
  ): Promise<{ sent: number }> {
    const emit: EmitInput = {
      type: NotificationType.ADMIN_MESSAGE,
      title: input.title,
      body: input.body,
      email: { subject: input.title, html: `<p>${input.body}</p>` },
    };
    let recipients: string[];
    if (input.all) {
      const promoters = await this.prisma.user.findMany({
        where: { roles: { has: Role.promoter }, status: 'active' },
        select: { id: true },
      });
      recipients = promoters.map((p) => p.id);
    } else {
      const p = await this.prisma.user.findUnique({ where: { id: input.promoterId } });
      if (!p || !p.roles.includes(Role.promoter)) throw new NotFoundException('Promotor no encontrado');
      recipients = [p.id];
    }
    await this.emitToMany(recipients, emit);
    await this.audit
      .record({ userId: actorId, action: 'notification.admin_send', resource: input.all ? 'all' : input.promoterId, payload: { count: recipients.length, title: input.title } })
      .catch(() => undefined);
    return { sent: recipients.length };
  }

  // ---------------------------------------------------------------------------
  // Emisión
  // ---------------------------------------------------------------------------

  /** Emite a UN usuario (in-app + socket + correo opcional). No lanza. */
  async emit(userId: string, input: EmitInput): Promise<void> {
    try {
      if (await this.channelEnabled(userId, input.type, 'inapp')) {
        const n = await this.prisma.notification.create({
          data: {
            userId,
            type: input.type,
            title: input.title,
            body: input.body ?? null,
            payload: input.payload,
            resourceType: input.resourceType ?? null,
            resourceId: input.resourceId ?? null,
          },
        });
        this.gateway.emitNotification(userId, n);
        this.gateway.emitUnread(userId, await this.unreadCount(userId));
      }
      if (input.email && (await this.channelEnabled(userId, input.type, 'email'))) {
        await this.queue.enqueue(QUEUES.MAIL, 'notification', { userId, ...input.email });
      }
    } catch (e) {
      this.logger.warn(`emit ${input.type} → ${userId}: ${(e as Error).message}`);
    }
  }

  /** Emite a varios usuarios (fan-out secuencial; cada uno aislado). */
  async emitToMany(userIds: string[], input: EmitInput): Promise<void> {
    for (const id of userIds) await this.emit(id, input);
  }

  /** Emite a todos los usuarios ACTIVOS con un rol dado (p.ej. avisar a los admins). */
  async emitToRole(role: Role, input: EmitInput): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { roles: { has: role }, status: 'active' },
      select: { id: true },
    });
    await this.emitToMany(
      users.map((u) => u.id),
      input,
    );
  }

  // ---------------------------------------------------------------------------
  // Lectura / estado (usuario actual)
  // ---------------------------------------------------------------------------

  async list(userId: string, page: KeysetQuery) {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...keysetTake(page),
    });
    return keysetResult(rows, page);
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  /** Marca una notificación como leída (solo del dueño; IDOR → 404). */
  async markRead(userId: string, id: string) {
    const res = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (res.count === 0) {
      const exists = await this.prisma.notification.findFirst({ where: { id, userId } });
      if (!exists) throw new NotFoundException('Notificación no encontrada');
    }
    const count = await this.unreadCount(userId);
    this.gateway.emitUnread(userId, count);
    return { ok: true, unread: count };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    this.gateway.emitUnread(userId, 0);
    return { ok: true, unread: 0 };
  }

  // ---------------------------------------------------------------------------
  // Preferencias
  // ---------------------------------------------------------------------------

  async getPreferences(userId: string) {
    return this.prisma.notificationPreference.findMany({ where: { userId } });
  }

  async setPreference(userId: string, type: string, channel: NotificationChannel, enabled: boolean) {
    return this.prisma.notificationPreference.upsert({
      where: { userId_type_channel: { userId, type, channel } },
      update: { enabled },
      create: { userId, type, channel, enabled },
    });
  }

  private async channelEnabled(userId: string, type: string, channel: NotificationChannel): Promise<boolean> {
    // Interruptor MAESTRO de perfil para el correo (T7): si el usuario apagó las
    // notificaciones por correo, ninguna de negocio/soporte se envía por email (los
    // correos de SEGURIDAD no pasan por aquí, así que no se ven afectados).
    if (channel === 'email') {
      const u = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { emailNotificationsEnabled: true },
      });
      if (u && !u.emailNotificationsEnabled) return false;
    }
    const pref = await this.prisma.notificationPreference.findUnique({
      where: { userId_type_channel: { userId, type, channel } },
    });
    return pref ? pref.enabled : CHANNEL_DEFAULT[channel];
  }
}
