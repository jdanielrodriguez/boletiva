import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type {
  CreateInvitationsResponseDto,
  InvitationListItemDto,
  InvitationPeekDto,
} from './types';

/** Invitaciones de promotor por token (F4). */
@Injectable({ providedIn: 'root' })
export class InvitationsApi {
  private readonly api = inject(ApiClient);

  /** Invita a uno o varios correos (admin/promotor). Devuelve las URLs con token. */
  create(emails: string[]): Observable<CreateInvitationsResponseDto> {
    return this.api.post<CreateInvitationsResponseDto>('/promoters/invitations', { emails });
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
}
