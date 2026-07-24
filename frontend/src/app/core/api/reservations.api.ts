import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type {
  CheckoutReservationDto,
  CreateReservationDto,
  OrderResponseDto,
  ReservationResponseDto,
} from './types';

/**
 * Reservas anónimas y compartibles. Crear no requiere login; el token se puede
 * compartir por link; pagar (checkout) sí requiere sesión (crea la orden a
 * nombre del usuario logueado).
 */
@Injectable({ providedIn: 'root' })
export class ReservationsApi {
  private readonly api = inject(ApiClient);

  create(eventId: string, body: CreateReservationDto, captchaToken?: string): Observable<ReservationResponseDto> {
    return this.api.post<ReservationResponseDto>(`/events/${eventId}/reservations`, body, undefined, captchaOpts(captchaToken));
  }

  getByToken(token: string): Observable<ReservationResponseDto> {
    return this.api.get<ReservationResponseDto>(`/reservations/${token}`);
  }

  /**
   * Estado del cooldown anti-abuso del visitante (por IP). `retryAfterSeconds` es
   * AUTORITATIVO (viene del TTL en Redis) → sirve para pintar el cronómetro con el
   * tiempo real, incluso tras recargar la página.
   */
  cooldown(): Observable<ReservationCooldown> {
    return this.api.get<ReservationCooldown>(`/reservations/cooldown`);
  }

  /** Cancela la reserva: libera los cupos e inicia el cooldown (visitantes). */
  cancel(token: string): Observable<{ cancelled: boolean }> {
    return this.api.delete<{ cancelled: boolean }>(`/reservations/${token}`);
  }

  checkout(token: string, body: CheckoutReservationDto = {}): Observable<OrderResponseDto> {
    return this.api.post<OrderResponseDto>(`/reservations/${token}/checkout`, body);
  }
}

export interface ReservationCooldown {
  onCooldown: boolean;
  hasActive: boolean;
  retryAfterSeconds: number;
}

function captchaOpts(token?: string): { headers: Record<string, string> } | undefined {
  return token ? { headers: { 'x-captcha-token': token } } : undefined;
}
