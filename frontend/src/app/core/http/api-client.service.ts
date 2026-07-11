import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../config/api.tokens';
import { silentContext } from './http-context';

type QueryParams = Record<string, string | number | boolean | undefined | null>;

/** Opciones por petición (p.ej. marcarla como silenciosa: sin overlay global). */
interface RequestOptions {
  /** No oscurecer la pantalla con el overlay de carga global (sondeo de fondo). */
  silent?: boolean;
}

/**
 * Cliente HTTP tipado sobre HttpClient. Prefija la URL base del API (resuelta por
 * DI según plataforma) y centraliza la construcción de query params. Los
 * servicios de dominio del SDK se apoyan en él; la autenticación y el refresh los
 * añade el interceptor, no este cliente.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  get<T>(path: string, query?: QueryParams, opts?: RequestOptions): Observable<T> {
    return this.http.get<T>(this.url(path), {
      params: this.params(query),
      withCredentials: true,
      context: opts?.silent ? silentContext() : undefined,
    });
  }

  post<T>(path: string, body?: unknown, query?: QueryParams, opts?: RequestOptions): Observable<T> {
    return this.http.post<T>(this.url(path), body ?? {}, {
      params: this.params(query),
      withCredentials: true,
      context: opts?.silent ? silentContext() : undefined,
    });
  }

  patch<T>(path: string, body?: unknown): Observable<T> {
    return this.http.patch<T>(this.url(path), body ?? {}, { withCredentials: true });
  }

  put<T>(path: string, body?: unknown): Observable<T> {
    return this.http.put<T>(this.url(path), body ?? {}, { withCredentials: true });
  }

  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(this.url(path), { withCredentials: true });
  }

  /** Petición genérica (p.ej. DELETE con cuerpo, que delete() no admite). */
  request<T>(method: string, path: string, body?: unknown): Observable<T> {
    return this.http.request<T>(method, this.url(path), { body, withCredentials: true });
  }

  /** URL absoluta para casos especiales (p.ej. EventSource/SSE con access_token). */
  url(path: string): string {
    const clean = path.startsWith('/') ? path.slice(1) : path;
    return `${this.baseUrl}/${clean}`;
  }

  private params(query?: QueryParams): HttpParams | undefined {
    if (!query) return undefined;
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) params = params.set(key, String(value));
    }
    return params;
  }
}
