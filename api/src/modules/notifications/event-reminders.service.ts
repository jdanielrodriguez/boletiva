import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { NotificationsService } from './notifications.service';
import { NotificationType } from './notification.types';

/** Ventana para el aviso "tu evento está por empezar" (24 h antes). */
const STARTING_WINDOW_MS = 24 * 3_600_000;

/**
 * Recordatorios de evento (T5): avisa al promotor cuando su evento está por empezar
 * (dentro de 24 h) y cuando ha finalizado (por fecha). Sweeper HORARIO, una sola
 * instancia por lock de Redis, apagado por defecto y en test. Idempotente: deduplica
 * comprobando si ya existe una notificación de ese tipo para el evento (no requiere
 * flags en el schema). El cierre de caja (finalize) también emite EVENT_FINISHED; el
 * dedupe evita duplicados.
 */
@Injectable()
export class EventRemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventRemindersService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('notifications.eventReminders')) return;
    this.timer = setInterval(() => {
      void this.redis.tryLock('event-reminders', 10 * 60 * 1000).then((got) => {
        if (!got) return;
        return this.runReminders().catch((e) => this.logger.error(`Recordatorios fallaron: ${(e as Error).message}`));
      });
    }, 3_600_000); // cada hora
    this.logger.log('Recordatorios de evento activos (cada 1h)');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Corre una pasada de recordatorios. Devuelve cuántas notificaciones emitió. */
  async runReminders(now = new Date()): Promise<number> {
    let sent = 0;
    // Por empezar (dentro de 24 h, aún no empezado, publicado).
    const starting = await this.prisma.event.findMany({
      where: { status: 'published', startsAt: { gt: now, lte: new Date(now.getTime() + STARTING_WINDOW_MS) } },
      select: { id: true, name: true, promoterId: true, startsAt: true },
    });
    for (const e of starting) {
      if (await this.alreadyNotified(e.id, NotificationType.EVENT_STARTING)) continue;
      await this.notifications.emit(e.promoterId, {
        type: NotificationType.EVENT_STARTING,
        title: 'Tu evento está por empezar',
        body: `"${e.name}" comienza pronto.`,
        resourceType: 'event',
        resourceId: e.id,
      });
      sent++;
    }
    // Finalizados por fecha (endsAt pasó, no cancelados) sin aviso previo.
    const finished = await this.prisma.event.findMany({
      where: { endsAt: { lt: now }, status: { in: ['published', 'finished'] } },
      select: { id: true, name: true, promoterId: true },
    });
    for (const e of finished) {
      if (await this.alreadyNotified(e.id, NotificationType.EVENT_FINISHED)) continue;
      await this.notifications.emit(e.promoterId, {
        type: NotificationType.EVENT_FINISHED,
        title: 'Evento finalizado',
        body: `"${e.name}" ha finalizado.`,
        resourceType: 'event',
        resourceId: e.id,
      });
      sent++;
    }
    return sent;
  }

  private async alreadyNotified(eventId: string, type: string): Promise<boolean> {
    const n = await this.prisma.notification.findFirst({ where: { type, resourceType: 'event', resourceId: eventId } });
    return n != null;
  }
}
