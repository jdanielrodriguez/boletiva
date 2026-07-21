import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Observable, map } from 'rxjs';
import { SessionStore } from './session.store';

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
  return (): Observable<boolean | UrlTree> => {
    const session = inject(SessionStore);
    const router = inject(Router);
    return session.ensureLoaded().pipe(
      map((user) => {
        if (!user) return router.createUrlTree(['/login']);
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
export const verifiedEmailGuard: CanActivateFn = () => {
  const session = inject(SessionStore);
  const router = inject(Router);
  return session.ensureLoaded().pipe(
    map((user) => {
      if (!user) return router.createUrlTree(['/login']);
      return session.isEmailVerified() ? true : router.createUrlTree(['/verificar-correo']);
    }),
  );
};
