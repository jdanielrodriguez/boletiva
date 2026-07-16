import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { StreamService } from '../stream/stream.service';

/**
 * Sweeper de órdenes PENDIENTES vencidas (hallazgo 2.1 — el de mayor daño de negocio).
 *
 * Al hacer commit, los asientos pasan a `sold` y la orden queda `pending` con
 * `expiresAt = now + ventana de pago`. Si nunca se paga (nunca llega el webhook
 * `payment.failed`), esos asientos quedaban `sold` PARA SIEMPRE, bloqueando el aforo
 * sin ingresar un centavo. Este job periódico reclama las órdenes `pending` cuyo
 * `expiresAt` ya pasó: las marca `expired`, desactiva sus ítems y **devuelve los
 * asientos a `available`** (misma liberación que `PaymentsService.fail`, sin webhook),
 * empujando además el delta por SSE para que el mapa se actualice en vivo.
 *
 * setInterval (como el job de retención); env-gated (`orders.sweeperEnabled`), OFF en test.
 */
@Injectable()
export class OrdersSweeperService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrdersSweeperService.name);
  private timer?: NodeJS.Timeout;
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  /** Tope de órdenes por pasada (evita transacciones gigantes bajo acumulación). */
  private static readonly BATCH = 200;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stream: StreamService,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('orders.sweeperEnabled') ?? true;
    this.intervalMs = config.get<number>('orders.sweeperIntervalMs') ?? 60_000;
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return; // apagado en test y con ORDERS_SWEEPER_ENABLED=false
    this.timer = setInterval(() => {
      // M1: lock distribuido → en Cloud Run multi-instancia solo UNA barre por tick.
      void this.redis.tryLock('orders-sweeper', Math.floor(this.intervalMs * 0.9)).then((got) => {
        if (!got) return;
        return this.sweepExpired().catch((e) => this.logger.error(`Sweeper de órdenes falló: ${e.message}`));
      });
    }, this.intervalMs);
    this.logger.log(`Sweeper de órdenes pending activo (cada ${this.intervalMs}ms)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Reclama las órdenes `pending` vencidas: `expired` + ítems inactivos + asientos a
   * `available`. Idempotente y seguro ante concurrencia (el UPDATE condicional a
   * `status='pending'` evita pisar una orden que se pagó en la carrera). Devuelve
   * cuántas órdenes y asientos se liberaron.
   */
  async sweepExpired(now: Date = new Date()): Promise<{ orders: number; seats: number }> {
    const expired = await this.prisma.order.findMany({
      where: { status: 'pending', expiresAt: { lt: now } },
      select: { id: true, eventId: true, items: { select: { seatId: true } } },
      take: OrdersSweeperService.BATCH,
    });
    if (expired.length === 0) return { orders: 0, seats: 0 };

    let releasedSeats = 0;
    let releasedOrders = 0;
    for (const order of expired) {
      const seatIds = order.items.map((i) => i.seatId).filter((x): x is string => !!x);
      // UPDATE condicional: solo si sigue `pending` (no revive una pagada en carrera).
      const res = await this.prisma.$transaction(async (tx) => {
        const upd = await tx.order.updateMany({
          where: { id: order.id, status: 'pending' },
          data: { status: 'expired' },
        });
        if (upd.count === 0) return 0; // otra ruta la cambió (pagó/canceló) → no tocar
        await tx.orderItem.updateMany({ where: { orderId: order.id }, data: { active: false } });
        if (seatIds.length) {
          await tx.seat.updateMany({ where: { id: { in: seatIds } }, data: { status: 'available' } });
        }
        return 1;
      });
      if (res === 0) continue;
      releasedOrders += 1;
      releasedSeats += seatIds.length;
      // Push SSE: la orden venció y sus asientos volvieron al mapa (best-effort).
      this.stream.emitOrder(order.id, { status: 'expired' });
      if (seatIds.length) this.stream.emitSeat(order.eventId, { released: seatIds });
    }
    if (releasedOrders > 0) {
      this.logger.log(`Sweeper: ${releasedOrders} órdenes vencidas, ${releasedSeats} asientos liberados`);
    }
    return { orders: releasedOrders, seats: releasedSeats };
  }
}
