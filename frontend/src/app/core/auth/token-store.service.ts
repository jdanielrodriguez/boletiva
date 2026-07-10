import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

const SESSION_HINT_KEY = 'pe_session';

/**
 * Custodia de tokens, segura para SSR.
 * - accessToken: SOLO en memoria (signal). No se persiste → menos superficie XSS
 *   y en SSR arranca vacío (render anónimo/público).
 * - refreshToken: YA NO se guarda en el cliente. Vive en una cookie httpOnly
 *   emitida por el backend (inaccesible a JS → mitiga XSS). El navegador la
 *   reenvía a `/auth/refresh` con `withCredentials`.
 * - marca de sesión (`pe_session`): un simple booleano en localStorage que indica
 *   "probablemente hay una sesión". NO es un secreto: solo evita intentar un
 *   refresh (y su 401) cuando el usuario nunca inició sesión. Se pone al obtener
 *   un access token y se borra al cerrar sesión o si el refresh falla.
 */
@Injectable({ providedIn: 'root' })
export class TokenStore {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private readonly _accessToken = signal<string | null>(null);
  private readonly _sessionHint = signal<boolean>(
    this.isBrowser ? localStorage.getItem(SESSION_HINT_KEY) === '1' : false,
  );

  readonly accessToken = this._accessToken.asReadonly();
  readonly hasSession = computed(() => this._sessionHint() || this._accessToken() !== null);

  getAccessToken(): string | null {
    return this._accessToken();
  }

  /** ¿Hay indicios de una sesión previa (cookie de refresh probable)? */
  hasSessionHint(): boolean {
    return this._sessionHint();
  }

  /** Marca que existe una sesión (tras login/refresh); el refresh vive en la cookie. */
  markSession(): void {
    this._sessionHint.set(true);
    if (this.isBrowser) localStorage.setItem(SESSION_HINT_KEY, '1');
  }

  /** Fija el access token en memoria y marca la sesión. */
  setAccessToken(accessToken: string): void {
    this._accessToken.set(accessToken);
    this.markSession();
  }

  clear(): void {
    this._accessToken.set(null);
    this._sessionHint.set(false);
    if (this.isBrowser) localStorage.removeItem(SESSION_HINT_KEY);
  }
}
