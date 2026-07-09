import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type {
  BannerResponseDto,
  CreateEventDto,
  CreateLocalityInput,
  LocalityView,
  ManagedEventDetailDto,
  UpdateEventDto,
} from './types';

/** Gestión de eventos del promotor (panel F4): CRUD, publicar/cancelar, banner y localidades. */
@Injectable({ providedIn: 'root' })
export class PromoterEventsApi {
  private readonly api = inject(ApiClient);

  /** Eventos del promotor autenticado (admin ve todos los que gestiona). */
  mine(): Observable<ManagedEventDetailDto[]> {
    return this.api.get<ManagedEventDetailDto[]>('/events/mine');
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

  cancel(id: string): Observable<ManagedEventDetailDto> {
    return this.api.post<ManagedEventDetailDto>(`/events/${id}/cancel`);
  }

  /** Genera (o regenera) el banner del evento con IA. */
  generateBanner(id: string): Observable<BannerResponseDto> {
    return this.api.post<BannerResponseDto>(`/events/${id}/banner`);
  }

  // --- Localidades ---
  localities(eventId: string): Observable<LocalityView[]> {
    return this.api.get<LocalityView[]>(`/events/${eventId}/localities`);
  }

  addLocality(eventId: string, dto: CreateLocalityInput): Observable<LocalityView> {
    return this.api.post<LocalityView>(`/events/${eventId}/localities`, dto);
  }
}
