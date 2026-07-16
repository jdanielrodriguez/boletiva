import { Injectable, Logger, MessageEvent, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { Observable, Subject, filter, map, merge, of } from 'rxjs';
import { RedisService } from '../../infra/redis/redis.service';

type StreamKind = 'order' | 'seat' | 'wallet';

interface StreamEvent {
  kind: StreamKind;
  orderId?: string;
  eventId?: string;
  userId?: string;
  data: unknown;
  /** Id de la instancia que originó el evento (para no re-entregar el propio). */
  origin?: string;
}

/** Datos mínimos de una orden para armar su stream (dueño + evento). */
export interface OrderStreamRef {
  id: string;
  buyerId: string;
  eventId: string;
}

/** Canal de Redis pub/sub para el fan-out de eventos SSE entre instancias. */
const CHANNEL = 'stream:events';

/**
 * Bus de eventos para push por SSE (sin polling). Los servicios publican cambios
 * (`order`/`seat`/`wallet`); el endpoint SSE se suscribe filtrando por orden/evento/usuario.
 *
 * M2 (multi-instancia Cloud Run): `emit*` entrega LOCAL de inmediato (a los clientes SSE
 * de ESTA instancia) Y PUBLICA en un canal Redis para las OTRAS instancias. Cada instancia
 * se SUSCRIBE (conexión dedicada) y reinyecta en su Subject SOLO los eventos ajenos (por
 * `origin`), evitando doble entrega en el origen. Así el webhook que confirma el pago en la
 * instancia A llega al cliente SSE pegado a la B. Sin Redis (o si falla el publish) queda la
 * entrega local → degradado a por-instancia, nunca rompe. `redis` es opcional (unit tests).
 */
@Injectable()
export class StreamService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StreamService.name);
  private readonly subject = new Subject<StreamEvent>();
  private subscriber?: Redis;
  private readonly instanceId = randomUUID();

  constructor(private readonly redis?: RedisService) {}

  async onModuleInit(): Promise<void> {
    if (!this.redis) return;
    try {
      this.subscriber = this.redis.getClient().duplicate();
      this.subscriber.on('message', (_channel, message) => {
        try {
          const event = JSON.parse(message) as StreamEvent;
          if (event.origin !== this.instanceId) this.subject.next(event); // solo ajenos
        } catch {
          /* mensaje corrupto → ignorar */
        }
      });
      await this.subscriber.subscribe(CHANNEL);
    } catch (e) {
      this.logger.warn(`SSE pub/sub no disponible (degradado a por-instancia): ${String(e)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit().catch(() => undefined);
  }

  private emit(event: StreamEvent): void {
    this.subject.next(event); // entrega local inmediata (clientes de esta instancia)
    // Fan-out a las otras instancias (best-effort). No re-entrega aquí (origin propio).
    this.redis
      ?.getClient()
      .publish(CHANNEL, JSON.stringify({ ...event, origin: this.instanceId }))
      .catch(() => undefined);
  }

  emitOrder(orderId: string, data: unknown): void {
    this.emit({ kind: 'order', orderId, data });
  }
  emitSeat(eventId: string, data: unknown): void {
    this.emit({ kind: 'seat', eventId, data });
  }
  emitWallet(userId: string, data: unknown): void {
    this.emit({ kind: 'wallet', userId, data });
  }

  /**
   * Stream SSE para el DUEÑO de una orden: estado de la orden + deltas de asientos
   * de su evento + actualizaciones de su wallet. Emite primero un `snapshot` (estado
   * actual) para no depender de haber estado conectado, y luego los eventos en vivo.
   */
  streamForOrder(order: OrderStreamRef, userId: string, snapshot: unknown): Observable<MessageEvent> {
    const live = this.subject.pipe(
      filter(
        (e) =>
          (e.kind === 'order' && e.orderId === order.id) ||
          (e.kind === 'seat' && e.eventId === order.eventId) ||
          (e.kind === 'wallet' && e.userId === userId),
      ),
      map((e): MessageEvent => ({ type: e.kind, data: e.data as object })),
    );
    const initial: MessageEvent = { type: 'snapshot', data: snapshot as object };
    return merge(of(initial), live);
  }
}
