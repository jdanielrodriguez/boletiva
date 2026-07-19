import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type {
  CheckinStatsDto,
  ValidatorDisabledDto,
  ValidatorInviteResponseDto,
  ValidatorListItemDto,
} from './types';

/** Dashboard de check-ins (contrato generado del OpenAPI). */
export type CheckinStats = CheckinStatsDto;

/**
 * Gestión de validadores de un evento (admin/promotor dueño). El promotor invita
 * por email → el backend crea un operador de puerta + asignación + invitación con
 * código y magic-link (se devuelven UNA vez). Deshabilitar corta el acceso al
 * instante; rehabilitar rota el acceso y reenvía.
 */
@Injectable({ providedIn: 'root' })
export class ValidatorsApi {
  private readonly api = inject(ApiClient);

  list(eventId: string): Observable<ValidatorListItemDto[]> {
    return this.api.get<ValidatorListItemDto[]>(`/events/${eventId}/validators`);
  }

  /** Dashboard de check-ins (avance, por localidad/validador, conflictos, timeline). */
  checkinStats(eventId: string): Observable<CheckinStats> {
    return this.api.get<CheckinStats>(`/events/${eventId}/validators/checkin-stats`);
  }

  /**
   * Emite un ticket de un solo uso (Bearer en header) para abrir el SSE del dashboard sin
   * poner el token de sesión en la URL. Se consume al abrir la conexión (?ticket=).
   */
  streamTicket(eventId: string): Observable<{ ticket: string; expiresIn: number }> {
    return this.api.post<{ ticket: string; expiresIn: number }>(
      `/events/${eventId}/validators/stream-ticket`,
      {},
    );
  }

  /** Invita/rehabilita por email → devuelve url + código (mostrar una sola vez). */
  invite(eventId: string, email: string): Observable<ValidatorInviteResponseDto> {
    return this.api.post<ValidatorInviteResponseDto>(`/events/${eventId}/validators`, { email });
  }

  disable(eventId: string, id: string): Observable<ValidatorDisabledDto> {
    return this.api.delete<ValidatorDisabledDto>(`/events/${eventId}/validators/${id}`);
  }

  disableAll(eventId: string): Observable<ValidatorDisabledDto> {
    return this.api.delete<ValidatorDisabledDto>(`/events/${eventId}/validators`);
  }

  /** Rehabilita y reenvía un nuevo acceso (rota el token/código). */
  enable(eventId: string, id: string): Observable<ValidatorInviteResponseDto> {
    return this.api.post<ValidatorInviteResponseDto>(`/events/${eventId}/validators/${id}/enable`, {});
  }
}
