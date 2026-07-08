import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
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
} as SessionUser;

describe('SessionStore', () => {
  let store: SessionStore;
  let tokens: TokenStore;
  let getSpy: jasmine.Spy<(path: string) => Observable<SessionUser>>;

  beforeEach(() => {
    localStorage.clear();
    getSpy = jasmine.createSpy('get').and.returnValue(of(USER));
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: ApiClient, useValue: { get: getSpy } }],
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

  it('ensureLoaded sin tokens → null, sin pegar al API', (done) => {
    store.ensureLoaded().subscribe((u) => {
      expect(u).toBeNull();
      expect(getSpy).not.toHaveBeenCalled();
      expect(store.loaded()).toBe(true);
      done();
    });
  });

  it('ensureLoaded con token → carga /auth/me', (done) => {
    tokens.setTokens('acc', 'ref');
    store.ensureLoaded().subscribe((u) => {
      expect(u).toEqual(USER);
      expect(getSpy).toHaveBeenCalledOnceWith('/auth/me');
      expect(store.isAuthenticated()).toBe(true);
      done();
    });
  });

  it('ensureLoaded cachea: no repite /auth/me', (done) => {
    tokens.setTokens('acc', 'ref');
    store.ensureLoaded().subscribe(() => {
      store.ensureLoaded().subscribe(() => {
        expect(getSpy).toHaveBeenCalledTimes(1);
        done();
      });
    });
  });

  it('ensureLoaded limpia la sesión si /auth/me falla', (done) => {
    tokens.setTokens('acc', 'ref');
    getSpy.and.returnValue(throwError(() => new Error('401')));
    store.ensureLoaded().subscribe((u) => {
      expect(u).toBeNull();
      expect(store.isAuthenticated()).toBe(false);
      expect(tokens.getRefreshToken()).toBeNull();
      done();
    });
  });
});
