import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, finalize, of, shareReplay, tap, throwError } from 'rxjs';
import { API_BASE_URL } from '../config/api.tokens';
import { TokenStore } from './token-store.service';

/** Forma de la respuesta de tokens del backend (auth). Alineada con TokensDto del SDK. */
export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
}

/**
 * Coordina la rotación del refresh token. Deduplica peticiones concurrentes: si
 * varias llamadas reciben 401 a la vez, todas comparten UN solo refresh en vuelo.
 * La petición de refresh se hace con HttpClient directo para no reentrar al
 * interceptor.
 *
 * El refresh token viaja en la cookie httpOnly `refresh_token` (no en el body):
 * la petición va con `withCredentials` para que el navegador la reenvíe. El
 * backend rota la cookie en la respuesta. Solo se intenta si hay marca de sesión
 * (evita un 401 innecesario para visitantes anónimos).
 */
@Injectable({ providedIn: 'root' })
export class AuthRefreshService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);
  private readonly tokens = inject(TokenStore);

  private inFlight: Observable<AuthTokens | null> | null = null;

  /** URL del endpoint de refresh (para que el interceptor no la reintente). */
  readonly refreshUrl = `${this.baseUrl}/auth/refresh`;

  refresh(): Observable<AuthTokens | null> {
    if (this.inFlight) return this.inFlight;

    // Sin indicios de sesión no hay cookie que rotar: no pegamos al backend.
    if (!this.tokens.hasSessionHint()) return of(null);

    this.inFlight = this.http
      .post<AuthTokens>(this.refreshUrl, {}, { withCredentials: true })
      .pipe(
        tap((t) => this.tokens.setAccessToken(t.accessToken)),
        catchError((err) => {
          // Refresh inválido/expirado o reuso detectado → sesión terminada.
          this.tokens.clear();
          return throwError(() => err);
        }),
        finalize(() => (this.inFlight = null)),
        shareReplay(1),
      );
    return this.inFlight;
  }
}
