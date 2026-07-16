import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { ApiClient } from '../http/api-client.service';

export interface OrderStreamEvent {
  type: 'snapshot' | 'order' | 'seat' | 'wallet';
  data: unknown;
}

/**
 * Suscripción SSE al estado de una orden (`GET /orders/:id/stream`). Empuja
 * snapshot inicial + eventos `order`/`seat`/`wallet` → el checkout reacciona sin
 * polling. Solo en navegador (EventSource no existe en SSR); en SSR devuelve un
 * Observable vacío.
 *
 * Auth (H4): primero pide por Bearer (header) un TICKET de un solo uso
 * (`POST /orders/:id/stream-ticket`) y abre el SSE con `?ticket=` → el access token
 * (larga vida) ya NO viaja en la URL/logs. Solo el ticket (60 s, un uso) queda en la URL.
 */
@Injectable({ providedIn: 'root' })
export class OrderStreamService {
  private readonly api = inject(ApiClient);
  private readonly platformId = inject(PLATFORM_ID);

  stream(orderId: string): Observable<OrderStreamEvent> {
    if (!isPlatformBrowser(this.platformId)) return new Observable<OrderStreamEvent>();

    return new Observable<OrderStreamEvent>((subscriber) => {
      let es: EventSource | undefined;
      let closed = false;

      void this.mintTicket(orderId)
        .then((ticket) => {
          if (closed) return;
          const url = `${this.api.url(`/orders/${orderId}/stream`)}?ticket=${encodeURIComponent(ticket)}`;
          es = new EventSource(url);
          const forward = (type: OrderStreamEvent['type']) => (ev: MessageEvent) => {
            try {
              subscriber.next({ type, data: JSON.parse(ev.data) });
            } catch {
              subscriber.next({ type, data: ev.data });
            }
          };
          es.addEventListener('snapshot', forward('snapshot'));
          es.addEventListener('order', forward('order'));
          es.addEventListener('seat', forward('seat'));
          es.addEventListener('wallet', forward('wallet'));
          es.onerror = () => {
            if (es && es.readyState === EventSource.CLOSED) subscriber.complete();
          };
        })
        .catch((e) => subscriber.error(e));

      return () => {
        closed = true;
        es?.close();
      };
    });
  }

  /** Pide el ticket de un solo uso (Bearer en header vía ApiClient). */
  private mintTicket(orderId: string): Promise<string> {
    return firstValueFrom(
      this.api.post<{ ticket: string }>(`/orders/${orderId}/stream-ticket`),
    ).then((r) => r.ticket);
  }
}
