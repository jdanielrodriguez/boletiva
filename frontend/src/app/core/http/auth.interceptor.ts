import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, switchMap, throwError } from 'rxjs';
import { API_BASE_URL } from '../config/api.tokens';
import { AuthRefreshService } from '../auth/auth-refresh.service';
import { TokenStore } from '../auth/token-store.service';
import { EditUnlockStore } from '../events/edit-unlock.store';

/** Adjunta el access token en el header Authorization. */
function withBearer(req: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
  return req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}

/**
 * Interceptor de autenticación:
 * 1. Adjunta el Bearer SOLO a peticiones del propio API (no filtra el token a
 *    terceros).
 * 2. Ante un 401 (que no sea el propio refresh ni el login) intenta UN refresh
 *    coordinado y reintenta la petición original con el token nuevo.
 * SSR-safe: si no hay token (render anónimo en servidor), simplemente pasa.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const baseUrl = inject(API_BASE_URL);
  const tokens = inject(TokenStore);
  const refresher = inject(AuthRefreshService);
  const editUnlock = inject(EditUnlockStore);

  const isApiRequest = req.url.startsWith(baseUrl);
  if (!isApiRequest) return next(req);

  const isAuthFlow = req.url === refresher.refreshUrl || req.url.endsWith('/auth/login');

  const access = tokens.getAccessToken();
  let authed = access ? withBearer(req, access) : req;

  // Desbloqueo de edición (admin no-dueño): adjunta el token del evento activo en
  // las mutaciones. El promotor dueño nunca fija token → no se envía; backend lo
  // ignora para el dueño. Solo métodos que mutan.
  const unlockToken = editUnlock.headerToken();
  if (unlockToken && req.method !== 'GET' && req.method !== 'HEAD') {
    authed = authed.clone({ setHeaders: { 'x-edit-unlock': unlockToken } });
  }

  return next(authed).pipe(
    catchError((err: unknown) => {
      const is401 = err instanceof HttpErrorResponse && err.status === 401;
      if (!is401 || isAuthFlow || !tokens.hasSessionHint()) {
        return throwError(() => err);
      }
      return retryWithRefresh(req, next, refresher, err);
    }),
  );
};

function retryWithRefresh(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
  refresher: AuthRefreshService,
  originalError: unknown,
): Observable<HttpEvent<unknown>> {
  return refresher.refresh().pipe(
    switchMap((result) => {
      if (!result) return throwError(() => originalError);
      return next(withBearer(req, result.accessToken));
    }),
  );
}
