import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';

/** Categoría de soporte reutilizada por el KB. */
export type KbCategory =
  | 'billing'
  | 'payments_settlement'
  | 'event'
  | 'technical'
  | 'account'
  | 'other';

export type KbVisibility = 'public' | 'internal';
export type KbStatus = 'draft' | 'published';

/** Artículo público del FAQ. */
export interface KbPublicArticle {
  slug: string;
  question: string;
  answerHtml: string;
  category: KbCategory | null;
  tags: string[];
}

/** Artículo completo (gestión admin). */
export interface KbArticle extends KbPublicArticle {
  id: string;
  answerText?: string;
  locale: string;
  status: KbStatus;
  visibility: KbVisibility;
  sortOrder: number;
  viewCount: number;
  publishedAt: string | null;
  updatedAt: string;
}

export interface KbSuggestion {
  slug: string;
  question: string;
  answerText: string;
  score: number;
}

export interface KbUpsert {
  question: string;
  answerHtml: string;
  slug?: string;
  category?: KbCategory | null;
  locale?: string;
  visibility?: KbVisibility;
  tags?: string[];
  sortOrder?: number;
}

/** SDK de la Base de Conocimientos (T6): FAQ público + búsqueda + gestión admin. */
@Injectable({ providedIn: 'root' })
export class KbApi {
  private readonly api = inject(ApiClient);

  // Público
  listPublic(query?: { category?: KbCategory; locale?: string; q?: string }): Observable<KbPublicArticle[]> {
    return this.api.get<KbPublicArticle[]>('/kb', query);
  }
  getBySlug(slug: string): Observable<KbPublicArticle> {
    return this.api.get<KbPublicArticle>(`/kb/${encodeURIComponent(slug)}`);
  }
  search(q: string, locale?: string, limit?: number): Observable<KbSuggestion[]> {
    return this.api.get<KbSuggestion[]>('/kb/search', { q, locale, limit });
  }

  // Gestión (admin/asesor)
  adminList(query?: { category?: KbCategory; locale?: string; q?: string }): Observable<KbArticle[]> {
    return this.api.get<KbArticle[]>('/kb/admin', query);
  }
  adminGet(id: string): Observable<KbArticle> {
    return this.api.get<KbArticle>(`/kb/admin/${id}`);
  }
  create(dto: KbUpsert): Observable<KbArticle> {
    return this.api.post<KbArticle>('/kb', dto);
  }
  update(id: string, dto: Partial<KbUpsert>): Observable<KbArticle> {
    return this.api.patch<KbArticle>(`/kb/${id}`, dto);
  }
  publish(id: string): Observable<KbArticle> {
    return this.api.post<KbArticle>(`/kb/${id}/publish`, {});
  }
  unpublish(id: string): Observable<KbArticle> {
    return this.api.post<KbArticle>(`/kb/${id}/unpublish`, {});
  }
  remove(id: string): Observable<{ deleted: boolean }> {
    return this.api.delete<{ deleted: boolean }>(`/kb/${id}`);
  }
}
