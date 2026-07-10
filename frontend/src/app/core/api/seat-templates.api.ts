import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type {
  CreateSeatTemplateDto,
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

  list(): Observable<SeatTemplateResponseDto[]> {
    return this.api.get<SeatTemplateResponseDto[]>('/seat-templates');
  }
  get(id: string): Observable<SeatTemplateResponseDto> {
    return this.api.get<SeatTemplateResponseDto>(`/seat-templates/${id}`);
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
}
