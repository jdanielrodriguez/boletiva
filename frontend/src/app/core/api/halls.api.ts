import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type { CreateHallDto, HallResponseDto, ScopeDashboardDto, UpdateHallDto } from './types';

/**
 * Salones/venues (v3.5). Un salón es un lugar con ubicación (mapa) y, opcionalmente,
 * una plantilla de asientos base. Lectura para promotor/admin; escritura solo admin.
 * El promotor puede elegir un salón al crear un evento → prefija dirección/lat/lng.
 */
@Injectable({ providedIn: 'root' })
export class HallsApi {
  private readonly api = inject(ApiClient);

  /** Salones publicados (selector del promotor). */
  list(): Observable<HallResponseDto[]> {
    return this.api.get<HallResponseDto[]>('/halls');
  }
  /** Todos los salones en cualquier estado (gestión admin). */
  listAll(): Observable<HallResponseDto[]> {
    return this.api.get<HallResponseDto[]>('/halls/all');
  }
  get(id: string): Observable<HallResponseDto> {
    return this.api.get<HallResponseDto>(`/halls/${id}`);
  }
  /** Dashboard del salón: métricas agregadas de todos sus eventos (admin). */
  dashboard(id: string): Observable<ScopeDashboardDto> {
    return this.api.get<ScopeDashboardDto>(`/halls/${id}/dashboard`);
  }
  create(dto: CreateHallDto): Observable<HallResponseDto> {
    return this.api.post<HallResponseDto>('/halls', dto);
  }
  update(id: string, dto: UpdateHallDto): Observable<HallResponseDto> {
    return this.api.patch<HallResponseDto>(`/halls/${id}`, dto);
  }
  remove(id: string): Observable<unknown> {
    return this.api.delete(`/halls/${id}`);
  }
  publish(id: string): Observable<HallResponseDto> {
    return this.api.post<HallResponseDto>(`/halls/${id}/publish`);
  }
  unpublish(id: string): Observable<HallResponseDto> {
    return this.api.post<HallResponseDto>(`/halls/${id}/unpublish`);
  }
  hide(id: string): Observable<HallResponseDto> {
    return this.api.post<HallResponseDto>(`/halls/${id}/hide`);
  }
  unhide(id: string): Observable<HallResponseDto> {
    return this.api.post<HallResponseDto>(`/halls/${id}/unhide`);
  }
  disable(id: string): Observable<HallResponseDto> {
    return this.api.post<HallResponseDto>(`/halls/${id}/disable`);
  }
  enable(id: string): Observable<HallResponseDto> {
    return this.api.post<HallResponseDto>(`/halls/${id}/enable`);
  }
}
