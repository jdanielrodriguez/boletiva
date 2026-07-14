import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type {
  CreateSeatTemplateDto,
  ScopeDashboardDto,
  SeatTemplateResponseDto,
  UpdateSeatTemplateDto,
} from './types';

/**
 * Plantillas de asientos gestionables (v3.5). Alimentan el desplegable "Generar" del
 * editor de asientos (junto a los generadores locales). Lectura promotor/admin;
 * escritura solo admin. Las built-in del sistema no son editables/borrables (409).
 */
@Injectable({ providedIn: 'root' })
export class SeatTemplatesApi {
  private readonly api = inject(ApiClient);

  /** Publicadas + visibles (para el desplegable del editor). */
  list(): Observable<SeatTemplateResponseDto[]> {
    return this.api.get<SeatTemplateResponseDto[]>('/seat-templates');
  }
  /** Todas en cualquier estado (gestión admin). */
  listAll(): Observable<SeatTemplateResponseDto[]> {
    return this.api.get<SeatTemplateResponseDto[]>('/seat-templates/all');
  }
  get(id: string): Observable<SeatTemplateResponseDto> {
    return this.api.get<SeatTemplateResponseDto>(`/seat-templates/${id}`);
  }
  /** Dashboard de la plantilla: métricas de los eventos que la usan (admin). */
  dashboard(id: string): Observable<ScopeDashboardDto> {
    return this.api.get<ScopeDashboardDto>(`/seat-templates/${id}/dashboard`);
  }
  create(dto: CreateSeatTemplateDto): Observable<SeatTemplateResponseDto> {
    return this.api.post<SeatTemplateResponseDto>('/seat-templates', dto);
  }
  update(id: string, dto: UpdateSeatTemplateDto): Observable<SeatTemplateResponseDto> {
    return this.api.patch<SeatTemplateResponseDto>(`/seat-templates/${id}`, dto);
  }
  remove(id: string): Observable<unknown> {
    return this.api.delete(`/seat-templates/${id}`);
  }
  publish(id: string): Observable<SeatTemplateResponseDto> {
    return this.api.post<SeatTemplateResponseDto>(`/seat-templates/${id}/publish`);
  }
  unpublish(id: string): Observable<SeatTemplateResponseDto> {
    return this.api.post<SeatTemplateResponseDto>(`/seat-templates/${id}/unpublish`);
  }
  hide(id: string): Observable<SeatTemplateResponseDto> {
    return this.api.post<SeatTemplateResponseDto>(`/seat-templates/${id}/hide`);
  }
  unhide(id: string): Observable<SeatTemplateResponseDto> {
    return this.api.post<SeatTemplateResponseDto>(`/seat-templates/${id}/unhide`);
  }
  disable(id: string): Observable<SeatTemplateResponseDto> {
    return this.api.post<SeatTemplateResponseDto>(`/seat-templates/${id}/disable`);
  }
  enable(id: string): Observable<SeatTemplateResponseDto> {
    return this.api.post<SeatTemplateResponseDto>(`/seat-templates/${id}/enable`);
  }
}
