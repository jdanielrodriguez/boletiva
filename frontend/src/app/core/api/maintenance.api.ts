import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';

/** Estado público del modo mantenimiento (contrato del backend). */
export interface MaintenanceStatus {
  enabled: boolean;
  message: string | null;
}

/**
 * SDK del modo mantenimiento. `status()` es público (lo consulta cualquiera al
 * arrancar); `disable()` es admin (desactiva desde el banner superior).
 */
@Injectable({ providedIn: 'root' })
export class MaintenanceApi {
  private readonly api = inject(ApiClient);

  /** Estado público: ¿está la plataforma en mantenimiento? + mensaje. */
  status(): Observable<MaintenanceStatus> {
    return this.api.get<MaintenanceStatus>('/maintenance');
  }

  /** Desactiva el mantenimiento (solo admin; el backend valida el rol). */
  disable(): Observable<MaintenanceStatus> {
    return this.api.patch<MaintenanceStatus>('/admin/maintenance', { enabled: false });
  }
}
