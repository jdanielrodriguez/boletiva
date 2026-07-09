import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type { Schemas } from './types';

export type PromoterListItemDto = Schemas['PromoterListItemDto'];
export type AdminEventListItemDto = Schemas['AdminEventListItemDto'];
export type GatewayResponseDto = Schemas['GatewayResponseDto'];

/**
 * SDK de administración (panel /configuracion, solo admin): gestión de promotores,
 * reparto de gastos (cost-share), pasarelas y listado global de eventos. Reusa los
 * endpoints admin existentes del backend.
 */
@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly api = inject(ApiClient);

  // --- Promotores ---
  listPromoters(status?: string): Observable<PromoterListItemDto[]> {
    return this.api.get<PromoterListItemDto[]>('/promoters', status ? { status } : undefined);
  }
  approvePromoter(id: string): Observable<unknown> {
    return this.api.post(`/promoters/${id}/approve`);
  }
  rejectPromoter(id: string, note?: string): Observable<unknown> {
    return this.api.post(`/promoters/${id}/reject`, { note });
  }
  suspendPromoter(id: string, note?: string): Observable<unknown> {
    return this.api.post(`/promoters/${id}/suspend`, { note });
  }
  getRequireApproval(): Observable<{ requireApproval: boolean }> {
    return this.api.get<{ requireApproval: boolean }>('/promoters/settings');
  }
  setRequireApproval(requireApproval: boolean): Observable<{ requireApproval: boolean }> {
    return this.api.patch<{ requireApproval: boolean }>('/promoters/settings', { requireApproval });
  }

  // --- Cost-share (reparto de gastos extra) ---
  getDefaultPct(): Observable<{ defaultPct: number }> {
    return this.api.get<{ defaultPct: number }>('/cost-share/default');
  }
  setDefaultPct(pct: number): Observable<unknown> {
    return this.api.patch('/cost-share/default', { pct });
  }
  setPromoterPct(id: string, pct: number): Observable<unknown> {
    return this.api.patch(`/cost-share/promoter/${id}`, { pct });
  }

  // --- Pasarelas ---
  listGateways(): Observable<GatewayResponseDto[]> {
    return this.api.get<GatewayResponseDto[]>('/payment-gateways');
  }

  // --- Eventos (todos) ---
  listAllEvents(): Observable<AdminEventListItemDto[]> {
    return this.api.get<AdminEventListItemDto[]>('/events/all');
  }
}
