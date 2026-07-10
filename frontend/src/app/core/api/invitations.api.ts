import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type {
  CreateInvitationsResponseDto,
  InvitationByTokenDto,
  InvitationListItemDto,
  InvitationPeekDto,
} from './types';

/** Invitaciones de promotor por token (F4). */
@Injectable({ providedIn: 'root' })
export class InvitationsApi {
  private readonly api = inject(ApiClient);

  /** Invita a uno o varios correos (admin/promotor). Devuelve las URLs con token.
   * `isTestUser` marca a los invitados como usuarios de prueba (anclados a Sandbox). */
  create(emails: string[], isTestUser = false): Observable<CreateInvitationsResponseDto> {
    return this.api.post<CreateInvitationsResponseDto>('/promoters/invitations', { emails, isTestUser });
  }

  /** Mis invitaciones (admin ve todas). */
  list(): Observable<InvitationListItemDto[]> {
    return this.api.get<InvitationListItemDto[]>('/promoters/invitations');
  }

  /** Revoca una invitación pendiente. */
  revoke(id: string): Observable<{ id: string; status: string }> {
    return this.api.delete<{ id: string; status: string }>(`/promoters/invitations/${id}`);
  }

  /** Vista pública para precargar el registro (valida el token → correo). */
  peek(token: string): Observable<InvitationPeekDto> {
    return this.api.get<InvitationPeekDto>('/promoters/invitations/peek', { token });
  }

  /** Acepta la invitación: el usuario autenticado queda auto-aprobado como promotor. */
  accept(token: string): Observable<{ accepted: boolean }> {
    return this.api.post<{ accepted: boolean }>('/promoters/invitations/accept', { token });
  }

  /** Vista pública por token en la URL: correo invitado + si YA existe una cuenta
   * (→ activar rol iniciando sesión, sin registro) o no (→ registro precargado). */
  byToken(token: string): Observable<InvitationByTokenDto> {
    return this.api.get<InvitationByTokenDto>(
      `/promoters/invitations/by-token/${encodeURIComponent(token)}`,
    );
  }

  /** Acepta por token en la URL (cuenta existente): activa el rol promotor de un click. */
  acceptByToken(token: string): Observable<{ accepted: boolean }> {
    return this.api.post<{ accepted: boolean }>(
      `/promoters/invitations/by-token/${encodeURIComponent(token)}/accept`,
    );
  }
}
