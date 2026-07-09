import { Injector, provideZonelessChangeDetection, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, CanActivateFn, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { Observable, firstValueFrom, of } from 'rxjs';
import { SessionStore } from './session.store';
import { authGuard, guestGuard, roleGuard, verifiedEmailGuard } from './guards';

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

  describe('guestGuard', () => {
    function runGuest(session: FakeSession, returnUrl?: string) {
      TestBed.configureTestingModule({
        providers: [provideZonelessChangeDetection(), provideRouter([]), { provide: SessionStore, useValue: session }],
      });
      const injector = TestBed.inject(Injector);
      const route = {
        queryParamMap: { get: (k: string) => (k === 'returnUrl' ? returnUrl ?? null : null) },
      } as unknown as ActivatedRouteSnapshot;
      const state = { url: '/login' } as RouterStateSnapshot;
      return runInInjectionContext(injector, () =>
        firstValueFrom(guestGuard(route, state) as Observable<boolean | UrlTree>),
      );
    }
    const withSession: FakeSession = {
      ensureLoaded: () => of({ id: 'u1' }),
      hasAnyRole: () => true,
      isEmailVerified: () => true,
    };
    const noSession: FakeSession = {
      ensureLoaded: () => of(null),
      hasAnyRole: () => false,
      isEmailVerified: () => false,
    };

    it('permite a un invitado (sin sesión) ver /login', async () => {
      expect(await runGuest(noSession)).toBe(true);
    });

    it('con sesión redirige al inicio', async () => {
      const res = await runGuest(withSession);
      expect((res as UrlTree).toString()).toBe('/');
    });

    it('con sesión y returnUrl seguro redirige a ese destino', async () => {
      const res = await runGuest(withSession, '/cuenta');
      expect((res as UrlTree).toString()).toBe('/cuenta');
    });

    it('con sesión ignora un returnUrl inseguro (open-redirect)', async () => {
      const res = await runGuest(withSession, '//evil.com');
      expect((res as UrlTree).toString()).toBe('/');
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
