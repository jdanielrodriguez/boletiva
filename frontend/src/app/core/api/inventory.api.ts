import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type { CreateHoldDto, HoldResponseDto } from './types';

/**
 * Reservas temporales (holds) sobre el Redis del backend. Dos modos:
 * `{ seatIds }` (numerada) o `{ localityId, quantity }` (general). Ambos
 * devuelven los seatIds concretos reservados (TTL ~10 min).
 */
@Injectable({ providedIn: 'root' })
export class InventoryApi {
  private readonly api = inject(ApiClient);

  hold(eventId: string, body: CreateHoldDto): Observable<HoldResponseDto> {
    return this.api.post<HoldResponseDto>(`/events/${eventId}/holds`, body);
  }

  /** Libera los holds propios de esos asientos (best-effort al salir/expirar). */
  release(eventId: string, seatIds: string[]): Observable<{ released: number }> {
    return this.api.request<{ released: number }>('DELETE', `/events/${eventId}/holds`, { seatIds });
  }
}
