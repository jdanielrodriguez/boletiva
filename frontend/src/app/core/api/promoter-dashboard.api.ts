import { HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type { PromoterDashboardDto } from './types';

/**
 * SDK del dashboard GLOBAL del promotor (Fase 3). El promotor ve el suyo; un admin
 * puede inspeccionar el de cualquier promotor pasando `promoterId`.
 */
@Injectable({ providedIn: 'root' })
export class PromoterDashboardApi {
  private readonly api = inject(ApiClient);

  /** KPIs de rentabilidad + ventas/día + tabla cruzada por dimensión. */
  dashboard(promoterId?: string): Observable<PromoterDashboardDto> {
    const q = promoterId ? `?promoterId=${encodeURIComponent(promoterId)}` : '';
    return this.api.get<PromoterDashboardDto>(`/promoter/dashboard${q}`);
  }

  /** Descarga el dashboard en Excel (.xlsx). Binario con auth (solo navegador). */
  export(promoterId?: string): Observable<HttpResponse<Blob>> {
    const q = promoterId ? `?promoterId=${encodeURIComponent(promoterId)}` : '';
    return this.api.getBlob(`/promoter/dashboard/export.xlsx${q}`);
  }
}
