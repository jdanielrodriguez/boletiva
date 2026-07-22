import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';

export interface AdvisorInviteResult {
  invitations: { id: string; email: string; isNewUser: boolean }[];
}
export interface AdvisorInvitePeek {
  email: string;
  needsPassword: boolean;
  valid: boolean;
}
export interface AdvisorInvitationRow {
  id: string;
  email: string;
  status: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

/**
 * SDK de invitaciones de asesor (T7e). Admin envía/lista; el destinatario valida el
 * token (peek), confirma (existente, autenticado) o fija contraseña (nuevo, por token).
 */
@Injectable({ providedIn: 'root' })
export class AdvisorInvitationsApi {
  private readonly api = inject(ApiClient);

  create(emails: string[]): Observable<AdvisorInviteResult> {
    return this.api.post<AdvisorInviteResult>('/advisors/invitations', { emails });
  }
  list(): Observable<AdvisorInvitationRow[]> {
    return this.api.get<AdvisorInvitationRow[]>('/advisors/invitations');
  }
  peek(token: string): Observable<AdvisorInvitePeek> {
    return this.api.get<AdvisorInvitePeek>(`/advisors/invitations/peek?token=${encodeURIComponent(token)}`);
  }
  accept(token: string): Observable<{ accepted: boolean }> {
    return this.api.post<{ accepted: boolean }>('/advisors/invitations/accept', { token });
  }
  setPassword(token: string, password: string): Observable<{ ok: boolean }> {
    return this.api.post<{ ok: boolean }>('/advisors/invitations/set-password', { token, password });
  }
}
