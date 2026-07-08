import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type { CategoryResponseDto } from './types';

/** Servicio del SDK para categorías (lectura pública). */
@Injectable({ providedIn: 'root' })
export class CategoriesApi {
  private readonly api = inject(ApiClient);

  /** Lista de categorías activas (públicas). */
  list(): Observable<CategoryResponseDto[]> {
    return this.api.get<CategoryResponseDto[]>('/categories');
  }

  getBySlug(slug: string): Observable<CategoryResponseDto> {
    return this.api.get<CategoryResponseDto>(`/categories/${slug}`);
  }
}
