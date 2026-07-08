import { Injectable, MessageEvent } from '@nestjs/common';
import { Observable, Subject, filter, map, merge, of } from 'rxjs';

type StreamKind = 'order' | 'seat' | 'wallet';

interface StreamEvent {
  kind: StreamKind;
  orderId?: string;
  eventId?: string;
  userId?: string;
  data: unknown;
}

/** Datos mínimos de una orden para armar su stream (dueño + evento). */
export interface OrderStreamRef {
  id: string;
  buyerId: string;
  eventId: string;
}

/**
 * Bus de eventos en proceso (RxJS) para push por SSE, evitando polling. Los
 * servicios publican cambios (`order`/`seat`/`wallet`) y el endpoint SSE se
 * suscribe filtrando por orden/evento/usuario.
 *
 * NOTA de producción (multi-instancia Cloud Run): este bus es por-instancia. Para
 * fan-out entre instancias, publicar/suscribir sobre Redis pub/sub detrás de la
 * misma interfaz (los clientes se reconectan a cualquier instancia). Documentado.
 */
@Injectable()
export class StreamService {
  private readonly subject = new Subject<StreamEvent>();

  emitOrder(orderId: string, data: unknown): void {
    this.subject.next({ kind: 'order', orderId, data });
  }
  emitSeat(eventId: string, data: unknown): void {
    this.subject.next({ kind: 'seat', eventId, data });
  }
  emitWallet(userId: string, data: unknown): void {
    this.subject.next({ kind: 'wallet', userId, data });
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
