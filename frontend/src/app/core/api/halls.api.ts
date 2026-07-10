import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type { CreateHallDto, HallResponseDto, UpdateHallDto } from './types';

/**
 * Salones/venues (v3.5). Un salón es un lugar con ubicación (mapa) y, opcionalmente,
 * una plantilla de asientos base. Lectura para promotor/admin; escritura solo admin.
 * El promotor puede elegir un salón al crear un evento → prefija dirección/lat/lng.
 */
@Injectable({ providedIn: 'root' })
export class HallsApi {
  private readonly api = inject(ApiClient);

  list(): Observable<HallResponseDto[]> {
    return this.api.get<HallResponseDto[]>('/halls');
  }
  get(id: string): Observable<HallResponseDto> {
    return this.api.get<HallResponseDto>(`/halls/${id}`);
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
}
