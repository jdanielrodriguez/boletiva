import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type { SettingViewDto } from './types';

/**
 * Catálogo de configuraciones del sistema (v3.5, solo admin). Cada entrada trae su
 * valor actual, default, tipo y si es `fallbackOnly` (informativo: el motor de
 * precios usa el fee_schedule activo). Escritura por clave con validación de tipo.
 */
@Injectable({ providedIn: 'root' })
export class SettingsApi {
  private readonly api = inject(ApiClient);

  list(): Observable<SettingViewDto[]> {
    return this.api.get<SettingViewDto[]>('/settings');
  }
  get(key: string): Observable<SettingViewDto> {
    return this.api.get<SettingViewDto>(`/settings/${encodeURIComponent(key)}`);
  }
  update(key: string, value: number | boolean | string): Observable<SettingViewDto> {
    return this.api.patch<SettingViewDto>(`/settings/${encodeURIComponent(key)}`, { value });
  }
}
