import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type { PublicEventDetailDto, PublicEventListDto } from './types';

/** Servicio del SDK para el catálogo público de eventos. */
@Injectable({ providedIn: 'root' })
export class EventsApi {
  private readonly api = inject(ApiClient);

  /** Lista de eventos publicados (paginación por skip/take). */
  listPublic(params?: { skip?: number; take?: number }): Observable<PublicEventListDto> {
    return this.api.get<PublicEventListDto>('/events', {
      skip: params?.skip,
      take: params?.take,
    });
  }

  /** Detalle público de un evento por slug. */
  getBySlug(slug: string): Observable<PublicEventDetailDto> {
    return this.api.get<PublicEventDetailDto>(`/events/${slug}`);
  }
}
