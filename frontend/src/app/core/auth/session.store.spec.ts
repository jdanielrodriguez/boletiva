import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import { AuthRefreshService, AuthTokens } from './auth-refresh.service';
import { SessionStore, SessionUser } from './session.store';
import { TokenStore } from './token-store.service';

const USER: SessionUser = {
  id: 'u1',
  email: 'ana@correo.com',
  firstName: 'Ana',
  lastName: null,
  roles: ['buyer'],
  status: 'active',
  emailVerified: true,
  twoFactorMethod: 'email',
  isTestUser: false,
  toursSeen: [],
  language: 'es',
} as SessionUser;

describe('SessionStore', () => {
  let store: SessionStore;
  let tokens: TokenStore;
  let getSpy: jasmine.Spy<(path: string) => Observable<SessionUser>>;
  let refreshSpy: jasmine.Spy<() => Observable<AuthTokens | null>>;

  beforeEach(() => {
    localStorage.clear();
    getSpy = jasmine.createSpy('get').and.returnValue(of(USER));
    refreshSpy = jasmine.createSpy('refresh').and.returnValue(of(null));
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ApiClient, useValue: { get: getSpy } },
        { provide: AuthRefreshService, useValue: { refresh: refreshSpy } },
      ],
    });
    store = TestBed.inject(SessionStore);
    tokens = TestBed.inject(TokenStore);
  });

  afterEach(() => localStorage.clear());

  it('setUser actualiza usuario y derivados', () => {
    store.setUser(USER);
    expect(store.isAuthenticated()).toBe(true);
    expect(store.roles()).toEqual(['buyer']);
    expect(store.isEmailVerified()).toBe(true);
    expect(store.hasRole('buyer')).toBe(true);
    expect(store.hasAnyRole(['admin', 'buyer'])).toBe(true);
    expect(store.hasAnyRole(['admin'])).toBe(false);
  });

  it('ensureLoaded sin sesión → null, sin pegar al API ni refrescar', (done) => {
    store.ensureLoaded().subscribe((u) => {
      expect(u).toBeNull();
      expect(getSpy).not.toHaveBeenCalled();
      expect(refreshSpy).not.toHaveBeenCalled();
      expect(store.loaded()).toBe(true);
      done();
    });
  });

  it('ensureLoaded con access token en memoria → /auth/me directo (sin refresh)', (done) => {
    tokens.setAccessToken('acc');
    store.ensureLoaded().subscribe((u) => {
      expect(u).toEqual(USER);
      expect(refreshSpy).not.toHaveBeenCalled();
      expect(getSpy).toHaveBeenCalledOnceWith('/auth/me');
      expect(store.isAuthenticated()).toBe(true);
      done();
    });
  });

  it('carga fría (solo marca de sesión) → refresca con la cookie y luego /auth/me', (done) => {
    tokens.markSession(); // hay cookie de refresh pero no access en memoria
    refreshSpy.and.returnValue(of({ accessToken: 'new' }));
    store.ensureLoaded().subscribe((u) => {
      expect(u).toEqual(USER);
      expect(refreshSpy).toHaveBeenCalledTimes(1);
      expect(getSpy).toHaveBeenCalledOnceWith('/auth/me'); // sin 401 previo
      expect(store.isAuthenticated()).toBe(true);
      done();
    });
  });

  it('carga fría con refresh sin sesión (null) → null y limpia, sin /auth/me', (done) => {
    tokens.markSession();
    refreshSpy.and.returnValue(of(null));
    store.ensureLoaded().subscribe((u) => {
      expect(u).toBeNull();
      expect(getSpy).not.toHaveBeenCalled();
      expect(store.isAuthenticated()).toBe(false);
      expect(tokens.hasSessionHint()).toBe(false);
      done();
    });
  });

  it('carga fría con refresh que falla → null y limpia', (done) => {
    tokens.markSession();
    refreshSpy.and.returnValue(throwError(() => new Error('401')));
    store.ensureLoaded().subscribe((u) => {
      expect(u).toBeNull();
      expect(store.isAuthenticated()).toBe(false);
      expect(tokens.hasSessionHint()).toBe(false);
      done();
    });
  });

  it('ensureLoaded cachea: no repite /auth/me', (done) => {
    tokens.setAccessToken('acc');
    store.ensureLoaded().subscribe(() => {
      store.ensureLoaded().subscribe(() => {
        expect(getSpy).toHaveBeenCalledTimes(1);
        done();
      });
    });
  });

  it('ensureLoaded limpia la sesión si /auth/me falla', (done) => {
    tokens.setAccessToken('acc');
    getSpy.and.returnValue(throwError(() => new Error('401')));
    store.ensureLoaded().subscribe((u) => {
      expect(u).toBeNull();
      expect(store.isAuthenticated()).toBe(false);
      expect(tokens.hasSessionHint()).toBe(false);
      done();
    });
  });
});
