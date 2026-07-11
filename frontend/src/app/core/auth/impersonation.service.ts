import { Injectable, computed, inject } from '@angular/core';
import { Observable, catchError, of, switchMap } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type { Schemas } from '../api/types';
import { AuthRefreshService } from './auth-refresh.service';
import { SessionStore, type SessionUser } from './session.store';
import { TokenStore } from './token-store.service';

export type ImpersonationResponse = Schemas['ImpersonationResponseDto'];

/**
 * Impersonación de soporte (v3.8 · G2): un admin actúa como un promotor para
 * dar soporte "viendo lo mismo que él". Seguridad/UX:
 * - `start(userId)` pide un access token de vida corta (`POST /admin/impersonate/:id`),
 *   lo pone EN MEMORIA (swap del `TokenStore`) y recarga `/auth/me` → el usuario
 *   resuelto es el promotor y trae `impersonatedBy` (id del admin).
 * - NO se toca la cookie httpOnly de refresh: sigue siendo la del admin. Por eso
 *   `stop()` solo tiene que rehacer un `refresh()` (con la cookie del admin) para
 *   recuperar el token de admin y volver a cargar su sesión — sin guardar el token
 *   de admin en ningún lado accesible.
 * - `active`/`asUser` derivan de `session.user().impersonatedBy` (fuente de verdad
 *   del backend), así el banner es inequívoco mientras dure la sesión impersonada.
 */
@Injectable({ providedIn: 'root' })
export class ImpersonationService {
  private readonly api = inject(ApiClient);
  private readonly tokens = inject(TokenStore);
  private readonly session = inject(SessionStore);
  private readonly refresher = inject(AuthRefreshService);

  /** ¿Hay una sesión de impersonación activa? (el token trae `impersonatedBy`). */
  readonly active = computed(() => !!this.session.user()?.impersonatedBy);
  /** Usuario que se está impersonando (el promotor), o null. */
  readonly asUser = computed<SessionUser | null>(() => (this.active() ? this.session.user() : null));

  /** Inicia la impersonación de `userId` (promotor). Swap del token + recarga sesión. */
  start(userId: string): Observable<SessionUser | null> {
    return this.api
      .post<ImpersonationResponse>(`/admin/impersonate/${userId}`)
      .pipe(
        switchMap((res) => {
          this.tokens.setAccessToken(res.accessToken);
          return this.session.loadMe();
        }),
      );
  }

  /**
   * Termina la impersonación: avisa al backend (con el token impersonado) para que
   * lo registre y luego restaura al admin refrescando con SU cookie httpOnly.
   */
  stop(): Observable<SessionUser | null> {
    return this.api.post('/admin/impersonate/stop').pipe(
      catchError(() => of(null)),
      switchMap(() => this.refresher.refresh()),
      switchMap((t) => (t ? this.session.loadMe() : of(this.session.user()))),
      catchError(() => of(this.session.user())),
    );
  }
}
