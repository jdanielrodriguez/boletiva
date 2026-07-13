import { HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type {
  BannerResponseDto,
  CreateEventDto,
  CreateLocalityInput,
  EditUnlockTokenDto,
  EventCashTransferDto,
  EventRefundResultDto,
  EventSettlementDto,
  EventTransactionPageDto,
  GatewayResponseDto,
  GenerateBannerDto,
  LocalityView,
  ManagedEventDetailDto,
  MyEventListItemDto,
  QuoteResponseDto,
  UpdateEventDto,
} from './types';

/** Asiento (para el editor de mapa del promotor). */
export interface SeatView {
  id: string;
  localityId: string;
  label: string;
  section?: string | null;
  row?: string | null;
  x?: number | null;
  y?: number | null;
  status: string;
}

/** Cuerpo para crear asientos en lote (con coordenadas opcionales). */
export interface BulkSeatInput {
  label: string;
  section?: string;
  row?: string;
  x?: number;
  y?: number;
}

/** Gestión de eventos del promotor (panel F4): CRUD, publicar/cancelar, banner,
 * localidades, asientos y liquidación por evento. */
@Injectable({ providedIn: 'root' })
export class PromoterEventsApi {
  private readonly api = inject(ApiClient);

  /** Eventos del promotor autenticado (admin ve todos los que gestiona). */
  mine(): Observable<MyEventListItemDto[]> {
    return this.api.get<MyEventListItemDto[]>('/events/mine');
  }

  get(id: string): Observable<ManagedEventDetailDto> {
    return this.api.get<ManagedEventDetailDto>(`/events/${id}/manage`);
  }

  create(dto: CreateEventDto): Observable<ManagedEventDetailDto> {
    return this.api.post<ManagedEventDetailDto>('/events', dto);
  }

  update(id: string, dto: UpdateEventDto): Observable<ManagedEventDetailDto> {
    return this.api.patch<ManagedEventDetailDto>(`/events/${id}`, dto);
  }

  publish(id: string): Observable<ManagedEventDetailDto> {
    return this.api.post<ManagedEventDetailDto>(`/events/${id}/publish`);
  }

  /** Suspende un evento publicado: lo despublica y lo deja reconfigurable (re-publicable). */
  suspend(id: string): Observable<ManagedEventDetailDto> {
    return this.api.post<ManagedEventDetailDto>(`/events/${id}/suspend`);
  }

  cancel(id: string): Observable<ManagedEventDetailDto> {
    return this.api.post<ManagedEventDetailDto>(`/events/${id}/cancel`);
  }

  remove(id: string): Observable<void> {
    return this.api.delete<void>(`/events/${id}`);
  }

  // --- Desbloqueo de edición para ADMIN no-dueño (OTP al correo) ---
  /** Envía un OTP al correo del admin para desbloquear la edición del evento. */
  requestEditUnlock(id: string): Observable<{ sent: boolean }> {
    return this.api.post<{ sent: boolean }>(`/events/${id}/edit-unlock/request`);
  }
  /** Verifica el OTP → token de desbloqueo (5 min) que viaja como `x-edit-unlock`. */
  verifyEditUnlock(id: string, code: string): Observable<EditUnlockTokenDto> {
    return this.api.post<EditUnlockTokenDto>(`/events/${id}/edit-unlock/verify`, { code });
  }

  /** Genera (o regenera) el banner del evento con IA (prompt/plantilla/imágenes). */
  generateBanner(id: string, options?: GenerateBannerDto): Observable<BannerResponseDto> {
    return this.api.post<BannerResponseDto>(`/events/${id}/banner`, options ?? {});
  }

  /** Liquidación (cuentas) del evento sobre sus órdenes pagadas. */
  settlement(id: string): Observable<EventSettlementDto> {
    return this.api.get<EventSettlementDto>(`/events/${id}/settlement`);
  }

  /**
   * Descarga el detalle de la liquidación del evento en Excel (.xlsx). Binario que
   * exige auth (Bearer): pasa por el `authInterceptor`. Devuelve la respuesta
   * completa para leer el nombre de archivo del `Content-Disposition`. Solo navegador.
   */
  exportSettlement(eventId: string): Observable<HttpResponse<Blob>> {
    return this.api.getBlob(`/events/${eventId}/settlement/export.xlsx`);
  }

  /**
   * Cierra el evento y TRANSFIERE su saldo de caja al wallet del promotor (SOLO
   * admin). Elegible si el evento está finalizado/suspendido o su fecha de fin ya
   * pasó. Idempotente: si ya se transfirió responde 409.
   */
  finalizeSettlement(id: string): Observable<EventCashTransferDto> {
    return this.api.post<EventCashTransferDto>(`/events/${id}/settlement/finalize`);
  }

  /**
   * Tramita devoluciones por cancelación/suspensión del evento (SOLO admin).
   * Acredita SOLO el NETO del boleto a la wallet del comprador (la cuota de
   * servicio no se devuelve). Con `orderId` devuelve una orden; sin él (o `{}`),
   * TODAS las pagadas. Idempotente. Requiere que el evento esté suspendido/cancelado.
   */
  refundEvent(id: string, orderId?: string): Observable<EventRefundResultDto> {
    return this.api.post<EventRefundResultDto>(
      `/events/${id}/refunds`,
      orderId ? { orderId } : {},
    );
  }

  /** Transacciones (órdenes) del evento, paginadas por keyset (?cursor&limit). */
  transactions(id: string, cursor?: string, limit = 20): Observable<EventTransactionPageDto> {
    return this.api.get<EventTransactionPageDto>(`/events/${id}/transactions`, {
      ...(cursor ? { cursor } : {}),
      limit,
    });
  }

  /** Pasarelas activas disponibles para asignar a un evento. */
  activeGateways(): Observable<GatewayResponseDto[]> {
    return this.api.get<GatewayResponseDto[]>('/payment-gateways/active');
  }

  /** Cotización server-authoritative de un neto (preview del precio por localidad). */
  quote(net: number): Observable<QuoteResponseDto> {
    return this.api.get<QuoteResponseDto>(`/pricing/quote?net=${encodeURIComponent(net)}`);
  }

  // --- Localidades ---
  localities(eventId: string): Observable<LocalityView[]> {
    return this.api.get<LocalityView[]>(`/events/${eventId}/localities`);
  }

  addLocality(eventId: string, dto: CreateLocalityInput): Observable<LocalityView> {
    return this.api.post<LocalityView>(`/events/${eventId}/localities`, dto);
  }

  updateLocality(localityId: string, dto: Partial<CreateLocalityInput>): Observable<LocalityView> {
    return this.api.patch<LocalityView>(`/localities/${localityId}`, dto);
  }

  removeLocality(localityId: string): Observable<void> {
    return this.api.delete<void>(`/localities/${localityId}`);
  }

  // --- Asientos (editor de mapa) ---
  seats(localityId: string): Observable<SeatView[]> {
    return this.api.get<SeatView[]>(`/localities/${localityId}/seats`);
  }

  /** Crea asientos en lote con coordenadas → { created, capacity }. */
  bulkSeats(localityId: string, seats: BulkSeatInput[]): Observable<{ created: number; capacity: number }> {
    return this.api.post<{ created: number; capacity: number }>(`/localities/${localityId}/seats`, { seats });
  }

  /**
   * Reemplaza el layout completo de una localidad de forma ATÓMICA con migración de
   * vendidos (P2): match por `label` (conserva el asiento vendido + su boleto,
   * actualiza posición), crea los nuevos, borra solo los `available`, y PRESERVA
   * cualquier vendido cuyo label ya no esté. Solo en eventos draft/suspendido.
   */
  replaceSeats(
    localityId: string,
    seats: BulkSeatInput[],
  ): Observable<{ created: number; updated: number; preserved: number; deleted: number; capacity: number }> {
    return this.api.put<{ created: number; updated: number; preserved: number; deleted: number; capacity: number }>(
      `/localities/${localityId}/seats`,
      { seats },
    );
  }

  deleteSeats(localityId: string, ids: string[]): Observable<{ deleted: number; capacity: number }> {
    return this.api.request<{ deleted: number; capacity: number }>('DELETE', `/localities/${localityId}/seats`, { ids });
  }
}
