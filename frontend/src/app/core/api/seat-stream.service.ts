import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';

/** Delta de disponibilidad de asientos de un evento (FU11). */
export interface SeatDelta {
  sold?: string[];
  released?: string[];
}

/**
 * Suscripción SSE PÚBLICA a la disponibilidad de asientos de un evento
 * (`GET /events/:id/seats/stream`). Empuja deltas `seat` ({sold|released}) para
 * repintar el mapa de compra en vivo. Solo navegador (EventSource no existe en SSR).
 */
@Injectable({ providedIn: 'root' })
export class SeatStreamService {
  private readonly api = inject(ApiClient);
  private readonly platformId = inject(PLATFORM_ID);

  stream(eventId: string): Observable<SeatDelta> {
    if (!isPlatformBrowser(this.platformId)) return new Observable<SeatDelta>();
    return new Observable<SeatDelta>((subscriber) => {
      const es = new EventSource(this.api.url(`/events/${eventId}/seats/stream`));
      es.addEventListener('seat', (ev: MessageEvent) => {
        try {
          subscriber.next(JSON.parse(ev.data) as SeatDelta);
        } catch {
          /* payload no-JSON: ignorar */
        }
      });
      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) subscriber.complete();
      };
      return () => es.close();
    });
  }
}
