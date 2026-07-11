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
});
