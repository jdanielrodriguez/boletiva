import { Injector, provideZonelessChangeDetection, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, CanActivateFn, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { Observable, firstValueFrom, of } from 'rxjs';
import { SessionStore } from './session.store';
import { authGuard, roleGuard, verifiedEmailGuard } from './guards';

interface FakeSession {
  ensureLoaded: () => Observable<unknown>;
  hasAnyRole: (roles: string[]) => boolean;
  isEmailVerified: () => boolean;
}

function runGuard(guard: CanActivateFn, session: FakeSession, url = '/protegido') {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), provideRouter([]), { provide: SessionStore, useValue: session }],
  });
  const injector = TestBed.inject(Injector);
  const route = {} as ActivatedRouteSnapshot;
  const state = { url } as RouterStateSnapshot;
  return runInInjectionContext(injector, () => {
    const result = guard(route, state) as Observable<boolean | UrlTree>;
    return firstValueFrom(result);
  });
}

describe('guards', () => {
  describe('authGuard', () => {
    it('permite con sesión', async () => {
      const res = await runGuard(authGuard, {
        ensureLoaded: () => of({ id: 'u1' }),
        hasAnyRole: () => true,
        isEmailVerified: () => true,
      });
      expect(res).toBe(true);
    });

    it('redirige a /login sin sesión (con returnUrl)', async () => {
      const res = await runGuard(
        authGuard,
        { ensureLoaded: () => of(null), hasAnyRole: () => false, isEmailVerified: () => false },
        '/mis-boletos',
      );
      expect(res instanceof UrlTree).toBe(true);
      expect((res as UrlTree).toString()).toContain('/login');
      expect((res as UrlTree).toString()).toContain('returnUrl=%2Fmis-boletos');
    });
  });

  describe('roleGuard', () => {
    it('permite si tiene el rol', async () => {
      const res = await runGuard(roleGuard('admin'), {
        ensureLoaded: () => of({ id: 'u1' }),
        hasAnyRole: (roles) => roles.includes('admin'),
        isEmailVerified: () => true,
      });
      expect(res).toBe(true);
    });

    it('redirige a /403 con sesión pero sin rol', async () => {
      const res = await runGuard(roleGuard('admin'), {
        ensureLoaded: () => of({ id: 'u1' }),
        hasAnyRole: () => false,
        isEmailVerified: () => true,
      });
      expect((res as UrlTree).toString()).toContain('/403');
    });

    it('redirige a /login sin sesión', async () => {
      const res = await runGuard(roleGuard('admin'), {
        ensureLoaded: () => of(null),
        hasAnyRole: () => false,
        isEmailVerified: () => false,
      });
      expect((res as UrlTree).toString()).toContain('/login');
    });
  });

  describe('verifiedEmailGuard', () => {
    it('permite con correo verificado', async () => {
      const res = await runGuard(verifiedEmailGuard, {
        ensureLoaded: () => of({ id: 'u1' }),
        hasAnyRole: () => true,
        isEmailVerified: () => true,
      });
      expect(res).toBe(true);
    });

    it('redirige a /verificar-correo si no está verificado', async () => {
      const res = await runGuard(verifiedEmailGuard, {
        ensureLoaded: () => of({ id: 'u1' }),
        hasAnyRole: () => true,
        isEmailVerified: () => false,
      });
      expect((res as UrlTree).toString()).toContain('/verificar-correo');
    });
  });
});
