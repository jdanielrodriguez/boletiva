import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import { AuthRefreshService } from './auth-refresh.service';
import { ImpersonationService } from './impersonation.service';
import { SessionStore, type SessionUser } from './session.store';
import { TokenStore } from './token-store.service';

describe('ImpersonationService (v3.8)', () => {
  let service: ImpersonationService;
  const userSig = signal<SessionUser | null>(null);
  let post: jasmine.Spy;
  let setAccessToken: jasmine.Spy;
  let loadMe: jasmine.Spy;
  let refresh: jasmine.Spy;

  beforeEach(() => {
    sessionStorage.clear();
    userSig.set(null);
    post = jasmine.createSpy('post').and.returnValue(
      of({ accessToken: 'imp-token', expiresIn: 1800, impersonatedBy: 'admin-1', user: { id: 'u2' } }),
    );
    setAccessToken = jasmine.createSpy('setAccessToken');
    loadMe = jasmine.createSpy('loadMe').and.callFake(() => {
      userSig.set({ id: 'u2', firstName: 'Leo', impersonatedBy: 'admin-1' } as SessionUser);
      return of(userSig());
    });
    refresh = jasmine.createSpy('refresh').and.returnValue(of({ accessToken: 'admin-token' }));

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ApiClient, useValue: { post } },
        { provide: TokenStore, useValue: { setAccessToken } },
        { provide: SessionStore, useValue: { loadMe, user: () => userSig() } },
        { provide: AuthRefreshService, useValue: { refresh } },
      ],
    });
    service = TestBed.inject(ImpersonationService);
  });

  it('start() cambia el token en memoria y recarga la sesión', () => {
    service.start('u2').subscribe();
    expect(post).toHaveBeenCalledWith('/admin/impersonate/u2');
    expect(setAccessToken).toHaveBeenCalledWith('imp-token');
    expect(loadMe).toHaveBeenCalled();
    expect(service.active()).toBe(true);
  });

  it('stop() avisa al backend, refresca al admin y recarga la sesión', () => {
    service.stop().subscribe();
    expect(post).toHaveBeenCalledWith('/admin/impersonate/stop');
    expect(refresh).toHaveBeenCalled();
    expect(loadMe).toHaveBeenCalled();
  });

  it('active/asUser derivan de impersonatedBy de la sesión', () => {
    expect(service.active()).toBe(false);
    userSig.set({ id: 'u2', firstName: 'Leo', impersonatedBy: 'admin-1' } as SessionUser);
    expect(service.active()).toBe(true);
    expect(service.asUser()?.firstName).toBe('Leo');
  });

  describe('persistencia al F5 (W9)', () => {
    it('start() persiste el token impersonado en sessionStorage', () => {
      service.start('u2').subscribe();
      expect(sessionStorage.getItem('pe_impersonation')).toBe('imp-token');
    });

    it('bootstrap() con token persistido lo coloca en el TokenStore y devuelve true', () => {
      sessionStorage.setItem('pe_impersonation', 'imp-token');
      const restored = service.bootstrap();
      expect(restored).toBe(true);
      expect(setAccessToken).toHaveBeenCalledWith('imp-token');
    });

    it('bootstrap() sin token no toca el TokenStore y devuelve false (flujo normal)', () => {
      const restored = service.bootstrap();
      expect(restored).toBe(false);
      expect(setAccessToken).not.toHaveBeenCalled();
    });

    it('stop() borra el token persistido', () => {
      sessionStorage.setItem('pe_impersonation', 'imp-token');
      service.stop().subscribe();
      expect(sessionStorage.getItem('pe_impersonation')).toBeNull();
    });

    it('reconcile() borra el token si la sesión NO quedó impersonada (token vencido)', () => {
      sessionStorage.setItem('pe_impersonation', 'stale');
      userSig.set({ id: 'admin-1', firstName: 'Admin' } as SessionUser); // sin impersonatedBy
      service.reconcile();
      expect(sessionStorage.getItem('pe_impersonation')).toBeNull();
    });

    it('reconcile() conserva el token si la sesión SÍ quedó impersonada', () => {
      sessionStorage.setItem('pe_impersonation', 'imp-token');
      userSig.set({ id: 'u2', impersonatedBy: 'admin-1' } as SessionUser);
      service.reconcile();
      expect(sessionStorage.getItem('pe_impersonation')).toBe('imp-token');
    });

    it('clearStored() borra el token (lo usa el logout)', () => {
      sessionStorage.setItem('pe_impersonation', 'imp-token');
      service.clearStored();
      expect(sessionStorage.getItem('pe_impersonation')).toBeNull();
    });
  });
});
