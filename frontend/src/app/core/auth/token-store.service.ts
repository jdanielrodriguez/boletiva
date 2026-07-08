import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

const REFRESH_KEY = 'pe_refresh';

/**
 * Custodia de tokens, segura para SSR.
 * - accessToken: SOLO en memoria (signal). No se persiste → menos superficie XSS
 *   y en SSR arranca vacío (render anónimo/público).
 * - refreshToken: se persiste en localStorage SOLO en el navegador para
 *   rehidratar la sesión entre recargas.
 *
 * NOTA de endurecimiento (F7/backend): la meta es mover el refresh a una cookie
 * httpOnly emitida por el backend (hoy el API lo devuelve en el body). Cuando el
 * backend lo soporte, este store deja de tocar localStorage. Ver core/http.
 */
@Injectable({ providedIn: 'root' })
export class TokenStore {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private readonly _accessToken = signal<string | null>(null);
  private readonly _refreshToken = signal<string | null>(
    this.isBrowser ? localStorage.getItem(REFRESH_KEY) : null,
  );

  readonly accessToken = this._accessToken.asReadonly();
  readonly hasSession = computed(() => this._refreshToken() !== null || this._accessToken() !== null);

  getAccessToken(): string | null {
    return this._accessToken();
  }

  getRefreshToken(): string | null {
    return this._refreshToken();
  }

  setTokens(accessToken: string, refreshToken: string): void {
    this._accessToken.set(accessToken);
    this._refreshToken.set(refreshToken);
    if (this.isBrowser) localStorage.setItem(REFRESH_KEY, refreshToken);
  }

  /** Actualiza solo el access token (p.ej. tras un refresh sin rotación). */
  setAccessToken(accessToken: string): void {
    this._accessToken.set(accessToken);
  }

  clear(): void {
    this._accessToken.set(null);
    this._refreshToken.set(null);
    if (this.isBrowser) localStorage.removeItem(REFRESH_KEY);
  }
}
