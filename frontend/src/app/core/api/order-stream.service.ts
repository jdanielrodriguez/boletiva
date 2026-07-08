import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { TokenStore } from '../auth/token-store.service';
import { ApiClient } from '../http/api-client.service';

export interface OrderStreamEvent {
  type: 'snapshot' | 'order' | 'seat' | 'wallet';
  data: unknown;
}

/**
 * Suscripción SSE al estado de una orden (`GET /orders/:id/stream`). Empuja
 * snapshot inicial + eventos `order`/`seat`/`wallet` → el checkout reacciona sin
 * polling. Solo en navegador (EventSource no existe en SSR); en SSR devuelve un
 * Observable vacío. Auth por `?access_token=` (EventSource no manda headers).
 */
@Injectable({ providedIn: 'root' })
export class OrderStreamService {
  private readonly api = inject(ApiClient);
  private readonly tokens = inject(TokenStore);
  private readonly platformId = inject(PLATFORM_ID);

  stream(orderId: string): Observable<OrderStreamEvent> {
    if (!isPlatformBrowser(this.platformId)) return new Observable<OrderStreamEvent>();

    return new Observable<OrderStreamEvent>((subscriber) => {
      const token = this.tokens.getAccessToken() ?? '';
      const url = `${this.api.url(`/orders/${orderId}/stream`)}?access_token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);

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
        // EventSource reintenta solo; si el server cerró, cerramos el stream.
        if (es.readyState === EventSource.CLOSED) subscriber.complete();
      };

      return () => es.close();
    });
  }
}
