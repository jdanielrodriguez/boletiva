import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, of, switchMap, tap } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type { PublicUserResponseDto } from '../api/types';
import { AuthRefreshService } from './auth-refresh.service';
import { TokenStore } from './token-store.service';

/**
 * Usuario de sesión: el tipo del SDK del endpoint /auth/me (fuente única de
 * verdad, generada del OpenAPI). Incluye roles, estado y verificación de correo.
 */
export type SessionUser = PublicUserResponseDto;

/**
 * Estado de sesión reactivo (signals, zoneless). Fuente única de verdad para
 * "¿quién es el usuario y qué puede hacer?". No guarda tokens (eso es TokenStore).
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly api = inject(ApiClient);
  private readonly tokens = inject(TokenStore);
  private readonly refresher = inject(AuthRefreshService);

  private readonly _user = signal<SessionUser | null>(null);
  private readonly _loaded = signal(false);

  readonly user = this._user.asReadonly();
  /** true una vez que se intentó resolver la sesión (evita parpadeos de guards). */
  readonly loaded = this._loaded.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);
  readonly roles = computed<string[]>(() => this._user()?.roles ?? []);
  readonly isEmailVerified = computed(() => this._user()?.emailVerified === true);

  hasRole(role: string): boolean {
    return this.roles().includes(role);
  }

  hasAnyRole(roles: string[]): boolean {
    const mine = this.roles();
    return roles.some((r) => mine.includes(r));
  }

  setUser(user: SessionUser | null): void {
    this._user.set(user);
    this._loaded.set(true);
  }

  /** Carga /auth/me si hay tokens; limpia la sesión si el token ya no sirve. */
  loadMe(): Observable<SessionUser | null> {
    return this.api.get<SessionUser>('/auth/me').pipe(tap((u) => this.setUser(u)));
  }

  /**
   * Resuelve la sesión una sola vez. Estrategia por escenario:
   * - Ya cargada → devuelve el usuario actual.
   * - Sin access token pero con marca de sesión (carga fría / F5): refresca
   *   PRIMERO con la cookie httpOnly y solo entonces llama a /auth/me → evita el
   *   401 visible de /auth/me sin token.
   * - Con access token en memoria (misma pestaña) → /auth/me directo.
   * - Sin nada → anónimo, sin tocar la red. La usan los guards.
   */
  ensureLoaded(): Observable<SessionUser | null> {
    if (this._loaded()) return of(this._user());

    const hasAccess = this.tokens.getAccessToken() !== null;
    const hasHint = this.tokens.hasSessionHint();

    if (!hasAccess && !hasHint) {
      this.setUser(null);
      return of(null);
    }

    if (!hasAccess && hasHint) {
      // Carga fría: refresh con cookie → me. Sin 401 de /auth/me.
      return this.refresher.refresh().pipe(
        switchMap((t) => {
          if (!t) {
            this.clear();
            return of(null);
          }
          return this.loadMe();
        }),
        catchError(() => {
          this.clear();
          return of(null);
        }),
      );
    }

    return this.loadMe().pipe(
      catchError(() => {
        this.clear();
        return of(null);
      }),
    );
  }

  clear(): void {
    this._user.set(null);
    this._loaded.set(true);
    this.tokens.clear();
  }
}
