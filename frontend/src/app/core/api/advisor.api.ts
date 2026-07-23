import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';

/** Estado de desbloqueo del asesor (para la UI). */
export interface AdvisorUnlockStatus {
  lockEnabled: boolean;
  unlocked: boolean;
  expiresAt: string | null;
  pending: boolean;
}

/** Estado de desbloqueo de un asesor en el panel admin (F3). */
export interface AdvisorUnlockState {
  advisorId: string;
  pending: boolean;
  requestedAt: string | null;
  unlocked: boolean;
  expiresAt: string | null;
}

/**
 * SDK del rol ASESOR (B2). El asesor solicita desbloqueo (correo con enlace al
 * admin) y consulta su estado; el admin aprueba desde el enlace. `devToken` solo
 * llega fuera de producción (para pruebas).
 */
@Injectable({ providedIn: 'root' })
export class AdvisorApi {
  private readonly api = inject(ApiClient);

  requestUnlock(): Observable<{ requested: boolean; devToken?: string }> {
    return this.api.post<{ requested: boolean; devToken?: string }>('/advisor/unlock/request', {});
  }

  status(): Observable<AdvisorUnlockStatus> {
    return this.api.get<AdvisorUnlockStatus>('/advisor/unlock/status');
  }

  approve(token: string): Observable<{ approved: boolean; advisorId: string; expiresAt: string | null }> {
    return this.api.post<{ approved: boolean; advisorId: string; expiresAt: string | null }>(
      '/advisor/unlock/approve',
      { token },
    );
  }

  /** (Admin) Estado de desbloqueo de los asesores con actividad, para el panel (F3). */
  listPending(): Observable<AdvisorUnlockState[]> {
    return this.api.get<AdvisorUnlockState[]>('/advisor/unlock/pending');
  }

  /** (Admin) Concede el desbloqueo directamente, sin depender del correo (F3). */
  grant(advisorId: string): Observable<{ granted: boolean; advisorId: string; expiresAt: string | null }> {
    return this.api.post<{ granted: boolean; advisorId: string; expiresAt: string | null }>(
      `/advisor/unlock/grant/${advisorId}`,
      {},
    );
  }
}
