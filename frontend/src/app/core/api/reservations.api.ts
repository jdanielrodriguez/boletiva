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

  /** Cancela la reserva: libera los cupos e inicia el cooldown (visitantes). */
  cancel(token: string): Observable<{ cancelled: boolean }> {
    return this.api.delete<{ cancelled: boolean }>(`/reservations/${token}`);
  }

  checkout(token: string, body: CheckoutReservationDto = {}): Observable<OrderResponseDto> {
    return this.api.post<OrderResponseDto>(`/reservations/${token}/checkout`, body);
  }
}

function captchaOpts(token?: string): { headers: Record<string, string> } | undefined {
  return token ? { headers: { 'x-captcha-token': token } } : undefined;
}
