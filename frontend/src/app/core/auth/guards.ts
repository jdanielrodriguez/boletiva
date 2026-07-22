import { PLATFORM_ID, inject } from '@angular/core';
import { isPlatformServer } from '@angular/common';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Observable, map, of } from 'rxjs';
import { SessionStore } from './session.store';

/**
 * En SSR la sesión es ANÓNIMA (el token vive en memoria del navegador y la cookie de
 * refresh no se reenvía al servidor), así que cualquier guard de auth rebotaría a /login
 * y, tras rehidratar en el cliente, terminaría en el inicio (bug de recarga). Se DIFIERE
 * la decisión al cliente: en el servidor el guard pasa (renderiza el shell; el contenido
 * de las páginas privadas se carga en el navegador con sesión), y al hidratar el guard
 * se reevalúa ya con la sesión restaurada → el usuario SE QUEDA en su ruta.
 */
function skipOnServer(): boolean {
  return isPlatformServer(inject(PLATFORM_ID));
}

/**
 * Sanea un `returnUrl` para evitar open-redirect: solo rutas internas absolutas
 * (`/algo`), nunca `//host` ni URLs externas. Devuelve '/' si no es seguro.
 */
export function safeReturnUrl(ret: string | null | undefined): string {
  return ret && ret.startsWith('/') && !ret.startsWith('//') ? ret : '/';
}

/**
 * Exige sesión iniciada. Resuelve /auth/me una vez (SSR y navegador) antes de
 * decidir, para no rebotar a /login mientras se hidrata. Sin sesión → /login
 * con returnUrl.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  if (skipOnServer()) return of(true);
  const session = inject(SessionStore);
  const router = inject(Router);
  return session.ensureLoaded().pipe(
    map((user) => (user ? true : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } }))),
  );
};

/**
 * Exige uno de los roles indicados. Úsese como factory en la ruta:
 * `canActivate: [roleGuard('admin')]`. Sin sesión → /login; con sesión pero sin
 * rol → /403.
 */
export function roleGuard(...roles: string[]): CanActivateFn {
  return (_route, state): Observable<boolean | UrlTree> => {
    if (skipOnServer()) return of(true);
    const session = inject(SessionStore);
    const router = inject(Router);
    return session.ensureLoaded().pipe(
      map((user) => {
        // Preserva returnUrl: en una RECARGA el SSR es anónimo y rebota a /login; sin
        // returnUrl, tras rehidratar la sesión el guestGuard mandaba a inicio (bug).
        // Con él, el usuario vuelve a la ruta exacta (incluida su ?tab=).
        if (!user) return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
        return session.hasAnyRole(roles) ? true : router.createUrlTree(['/403']);
      }),
    );
  };
}

/**
 * Solo para invitados (no logueados): /login y /registro. Con sesión activa
 * redirige al returnUrl (si es seguro) o al inicio — no tiene sentido re-loguearse.
 */
export const guestGuard: CanActivateFn = (route) => {
  if (skipOnServer()) return of(true);
  const session = inject(SessionStore);
  const router = inject(Router);
  return session.ensureLoaded().pipe(
    map((user) => {
      if (!user) return true;
      return router.createUrlTree([safeReturnUrl(route.queryParamMap.get('returnUrl'))]);
    }),
  );
};

/**
 * Exige el correo verificado (necesario para comprar/crear/transferir, igual que
 * @RequireVerifiedEmail en el backend). Con sesión sin verificar → /verificar-correo.
 */
export const verifiedEmailGuard: CanActivateFn = (_route, state) => {
  if (skipOnServer()) return of(true);
  const session = inject(SessionStore);
  const router = inject(Router);
  return session.ensureLoaded().pipe(
    map((user) => {
      if (!user) return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
      return session.isEmailVerified() ? true : router.createUrlTree(['/verificar-correo']);
    }),
  );
};
