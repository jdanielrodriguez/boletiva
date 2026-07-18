import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type {
  ValidatorDisabledDto,
  ValidatorInviteResponseDto,
  ValidatorListItemDto,
} from './types';

/**
 * Dashboard de check-ins del evento (`GET /events/:id/validators/checkin-stats`).
 * Tipeado a mano: el endpoint (Ola de validadores F2) aún no está re-exportado a
 * docs/openapi.json → re-exportar y regenerar el SDK es un follow-up; entonces esto
 * se reemplaza por el alias generado `CheckinStatsDto`.
 */
export interface CheckinStats {
  eventId: string;
  total: number;
  checkedIn: number;
  pending: number;
  transferred: number;
  revoked: number;
  conflicts: number;
  percent: number;
  byLocality: { localityId: string; name: string; total: number; checkedIn: number }[];
  byValidator: { operatorId: string | null; email: string | null; name: string | null; count: number }[];
  recent: { serial: string; locality: string | null; validator: string | null; at: string }[];
  updatedAt: string;
}

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
