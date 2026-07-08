import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type {
  EventAvailabilityDto,
  PublicEventDetailDto,
  PublicEventListDto,
  PublicEventListItemDto,
} from './types';

/** Servicio del SDK para el catálogo público de eventos. */
@Injectable({ providedIn: 'root' })
export class EventsApi {
  private readonly api = inject(ApiClient);

  /** Lista de eventos publicados (paginación por skip/take, filtro por categoría/búsqueda). */
  listPublic(params?: {
    skip?: number;
    take?: number;
    category?: string;
    search?: string;
  }): Observable<PublicEventListDto> {
    return this.api.get<PublicEventListDto>('/events', {
      skip: params?.skip,
      take: params?.take,
      category: params?.category,
      search: params?.search,
    });
  }

  /** Detalle público de un evento por slug. */
  getBySlug(slug: string): Observable<PublicEventDetailDto> {
    return this.api.get<PublicEventDetailDto>(`/events/${slug}`);
  }

  /** Eventos destacados para el slider del inicio (ordenados por prioridad). */
  promoted(): Observable<PublicEventListItemDto[]> {
    return this.api.get<PublicEventListItemDto[]>('/events/promoted');
  }

  /** Disponibilidad para comprar (mapa + localidades con precio + asientos). */
  availability(eventId: string): Observable<EventAvailabilityDto> {
    return this.api.get<EventAvailabilityDto>(`/events/${eventId}/availability`);
  }
}
