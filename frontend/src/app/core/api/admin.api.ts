import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type { CreateGatewayDto, Schemas, UpdateGatewayDto } from './types';

export type PromoterListItemDto = Schemas['PromoterListItemDto'];
export type AdminEventListItemDto = Schemas['AdminEventListItemDto'];
export type GatewayResponseDto = Schemas['GatewayResponseDto'];
export type PromoterStatusEventDto = Schemas['PromoterStatusEventDto'];

/**
 * El OpenAPI tipa `installmentRates` como objeto libre (Record<string, never>);
 * en realidad es un mapa cuotas→tasa numérica. Se corrige localmente para el SDK.
 */
export type GatewayCreate = Omit<CreateGatewayDto, 'installmentRates'> & {
  installmentRates?: Record<string, number>;
};
export type GatewayUpdate = Omit<UpdateGatewayDto, 'installmentRates'> & {
  installmentRates?: Record<string, number>;
};

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
  /** Historial append-only de transiciones de estado de un promotor. */
  promoterHistory(id: string): Observable<PromoterStatusEventDto[]> {
    return this.api.get<PromoterStatusEventDto[]>(`/promoters/${id}/history`);
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
  /** Envía un OTP al correo del admin para autorizar agregar una pasarela. */
  unlockGateway(): Observable<{ sent: boolean }> {
    return this.api.post<{ sent: boolean }>('/payment-gateways/unlock');
  }
  createGateway(dto: GatewayCreate): Observable<GatewayResponseDto> {
    return this.api.post<GatewayResponseDto>('/payment-gateways', dto);
  }
  updateGateway(id: string, dto: GatewayUpdate): Observable<GatewayResponseDto> {
    return this.api.patch<GatewayResponseDto>(`/payment-gateways/${id}`, dto);
  }
  setGatewayStatus(id: string, status: string): Observable<GatewayResponseDto> {
    return this.api.patch<GatewayResponseDto>(`/payment-gateways/${id}/status`, { status });
  }
  makeGatewayDefault(id: string): Observable<GatewayResponseDto> {
    return this.api.post<GatewayResponseDto>(`/payment-gateways/${id}/make-default`);
  }
  /** Elimina una pasarela (solo si está inactiva; el backend lo valida → 409). */
  deleteGateway(id: string): Observable<unknown> {
    return this.api.delete(`/payment-gateways/${id}`);
  }

  // --- Eventos (todos) ---
  listAllEvents(): Observable<AdminEventListItemDto[]> {
    return this.api.get<AdminEventListItemDto[]>('/events/all');
  }
}
