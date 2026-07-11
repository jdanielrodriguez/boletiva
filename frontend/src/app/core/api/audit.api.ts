import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';

/** Respuesta del endpoint de auditoría. */
export interface AuditConfirmResponse {
  message: string;
}

/**
 * SDK de la bitácora de auditoría (no-repudio). Registra un click de confirmación;
 * la IP y el user-agent los captura el backend (no se envían desde el cliente).
 * Solo mandamos `action`/`resource`/`payload`.
 */
@Injectable({ providedIn: 'root' })
export class AuditApi {
  private readonly api = inject(ApiClient);

  confirm(
    action: string,
    resource?: string,
    payload?: Record<string, unknown>,
  ): Observable<AuditConfirmResponse> {
    return this.api.post<AuditConfirmResponse>('/audit/confirm', {
      action,
      ...(resource !== undefined ? { resource } : {}),
      ...(payload !== undefined ? { payload } : {}),
    });
  }
}
