import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, of, tap } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type { PublicUserResponseDto } from '../api/types';
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
   * Resuelve la sesión una sola vez. Si ya está cargada, devuelve el usuario
   * actual; si hay tokens pero no se ha cargado, llama a /auth/me (y limpia si
   * falla). Sin tokens, marca cargado y devuelve null. La usan los guards.
   */
  ensureLoaded(): Observable<SessionUser | null> {
    if (this._loaded()) return of(this._user());
    if (!this.tokens.getRefreshToken() && !this.tokens.getAccessToken()) {
      this.setUser(null);
      return of(null);
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
