import { Injectable, PLATFORM_ID, computed, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, catchError, of, switchMap, tap } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type { Schemas } from '../api/types';
import { AuthRefreshService } from './auth-refresh.service';
import { SessionStore, type SessionUser } from './session.store';
import { TokenStore } from './token-store.service';

export type ImpersonationResponse = Schemas['ImpersonationResponseDto'];

/** Clave del token de impersonación en sessionStorage (sobrevive al F5, no al cierre). */
const STORAGE_KEY = 'pe_impersonation';

/**
 * Impersonación de soporte (v3.8 · G2): un admin actúa como un promotor para
 * dar soporte "viendo lo mismo que él". Seguridad/UX:
 * - `start(userId)` pide un access token de vida corta (`POST /admin/impersonate/:id`),
 *   lo pone en el `TokenStore` (swap) y recarga `/auth/me` → el usuario resuelto es
 *   el promotor y trae `impersonatedBy` (id del admin).
 * - NO se toca la cookie httpOnly de refresh: sigue siendo la del admin. Por eso
 *   `stop()` solo tiene que rehacer un `refresh()` (con la cookie del admin) para
 *   recuperar el token de admin y volver a cargar su sesión.
 * - `active`/`asUser` derivan de `session.user().impersonatedBy` (fuente de verdad
 *   del backend), así el banner es inequívoco mientras dure la sesión impersonada.
 *
 * v3.13 · W9: el token impersonado se PERSISTE en sessionStorage. Al boot,
 * `bootstrap()` lo coloca en el TokenStore ANTES de resolver la sesión → un F5
 * mantiene la vista de impersonación (el promotor + banner) en vez de revertir al
 * admin con el refresh de su cookie. `stop()` y `logout()` limpian el token.
 * SSR-safe (sessionStorage solo en el navegador).
 */
@Injectable({ providedIn: 'root' })
export class ImpersonationService {
  private readonly api = inject(ApiClient);
  private readonly tokens = inject(TokenStore);
  private readonly session = inject(SessionStore);
  private readonly refresher = inject(AuthRefreshService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** ¿Hay una sesión de impersonación activa? (el token trae `impersonatedBy`). */
  readonly active = computed(() => !!this.session.user()?.impersonatedBy);
  /** Usuario que se está impersonando (el promotor), o null. */
  readonly asUser = computed<SessionUser | null>(() => (this.active() ? this.session.user() : null));

  /** Inicia la impersonación de `userId` (promotor). Swap del token + recarga sesión. */
  start(userId: string): Observable<SessionUser | null> {
    return this.api.post<ImpersonationResponse>(`/admin/impersonate/${userId}`).pipe(
      switchMap((res) => {
        this.tokens.setAccessToken(res.accessToken);
        this.store(res.accessToken);
        return this.session.loadMe();
      }),
    );
  }

  /**
   * Termina la impersonación: avisa al backend (con el token impersonado) para que
   * lo registre, borra el token persistido y restaura al admin refrescando con SU
   * cookie httpOnly.
   */
  stop(): Observable<SessionUser | null> {
    return this.api.post('/admin/impersonate/stop').pipe(
      catchError(() => of(null)),
      tap(() => this.clearStored()),
      switchMap(() => this.refresher.refresh()),
      switchMap((t) => (t ? this.session.loadMe() : of(this.session.user()))),
      catchError(() => of(this.session.user())),
    );
  }

  /**
   * Boot de la app (navegador): si hay un token de impersonación persistido, lo
   * coloca en el TokenStore para que la carga de sesión resuelva al promotor (y no
   * al admin vía refresh). Devuelve true si había token que restaurar. Debe
   * llamarse ANTES de `SessionStore.ensureLoaded()`.
   */
  bootstrap(): boolean {
    if (!this.isBrowser) return false;
    const token = this.read();
    if (!token) return false;
    this.tokens.setAccessToken(token);
    return true;
  }

  /**
   * Limpieza posterior al boot: si se intentó restaurar pero la sesión NO quedó
   * impersonada (p.ej. el token corto ya venció → el interceptor cayó al admin),
   * descarta el token obsoleto para no reintentarlo en el próximo F5.
   */
  reconcile(): void {
    if (!this.active()) this.clearStored();
  }

  /** Borra el token de impersonación persistido (lo usan `stop()` y el logout). */
  clearStored(): void {
    if (!this.isBrowser) return;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* noop */
    }
  }

  private store(token: string): void {
    if (!this.isBrowser) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, token);
    } catch {
      /* noop */
    }
  }

  private read(): string | null {
    try {
      return sessionStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }
}
