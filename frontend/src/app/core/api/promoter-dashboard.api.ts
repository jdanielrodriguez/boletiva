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

  /** KPIs de rentabilidad + ventas/día + tabla cruzada por dimensión. Filtrable por evento/estado/fecha. */
  dashboard(promoterId?: string, eventId?: string, filters?: DashboardFilters): Observable<PromoterDashboardDto> {
    const q = this.buildQuery(promoterId, eventId, filters);
    return this.api.get<PromoterDashboardDto>(`/promoter/dashboard${q ? `?${q}` : ''}`);
  }

  /** Descarga el dashboard en Excel (.xlsx). Binario con auth (solo navegador). Respeta los filtros. */
  export(promoterId?: string, filters?: DashboardFilters): Observable<HttpResponse<Blob>> {
    const q = this.buildQuery(promoterId, undefined, filters);
    return this.api.getBlob(`/promoter/dashboard/export.xlsx${q ? `?${q}` : ''}`);
  }

  private buildQuery(promoterId?: string, eventId?: string, filters?: DashboardFilters): string {
    const params = new URLSearchParams();
    if (promoterId) params.set('promoterId', promoterId);
    if (eventId) params.set('eventId', eventId);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.from) params.set('from', filters.from);
    if (filters?.to) params.set('to', filters.to);
    return params.toString();
  }
}

/** Filtros server-side del dashboard: estado del evento + rango de fecha (`startsAt`). */
export interface DashboardFilters {
  status?: string;
  from?: string;
  to?: string;
}
