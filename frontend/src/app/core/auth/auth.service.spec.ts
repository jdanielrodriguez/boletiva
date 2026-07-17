import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AuthApi } from '../api/auth.api';
import type {
  LoginResponseDto,
  PublicUserResponseDto,
  SignupResponseDto,
  TokenPairResponseDto,
} from '../api/types';
import { ApiClient } from '../http/api-client.service';
import { I18nService } from '../i18n/i18n.service';
import { AuthRefreshService } from './auth-refresh.service';
import { AuthService } from './auth.service';
import { SessionStore } from './session.store';
import { TokenStore } from './token-store.service';

const USER: PublicUserResponseDto = {
  id: 'u1',
  email: 'ana@correo.com',
  firstName: 'Ana',
  lastName: null,
  phone: null,
  avatarUrl: null,
  roles: ['buyer'],
  status: 'active',
  emailVerified: false,
  twoFactorMethod: 'email',
  isTestUser: false,
  toursSeen: [],
  promoterTier: 'free',
  language: 'es',
};
const TOKENS: TokenPairResponseDto = { accessToken: 'acc', refreshToken: 'ref', expiresIn: 900 };

describe('AuthService', () => {
  let auth: AuthService;
  let tokens: TokenStore;
  let session: SessionStore;
  let api: jasmine.SpyObj<AuthApi>;

  beforeEach(() => {
    localStorage.clear();
    api = jasmine.createSpyObj<AuthApi>('AuthApi', [
      'login',
      'verify2fa',
      'signup',
      'logout',
      'changePassword',
      'forgotPassword',
      'resetPassword',
    ]);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: AuthApi, useValue: api },
        { provide: ApiClient, useValue: { get: () => of(null), post: () => of(null) } },
        { provide: AuthRefreshService, useValue: { refresh: () => of(null) } },
        { provide: I18nService, useValue: { use: () => undefined, reset: () => undefined } },
      ],
    });
    auth = TestBed.inject(AuthService);
    tokens = TestBed.inject(TokenStore);
    session = TestBed.inject(SessionStore);
  });

  afterEach(() => localStorage.clear());

  it('login "ok" guarda tokens e inicia sesión', (done) => {
    const res: LoginResponseDto = { status: 'ok', user: USER, tokens: TOKENS };
    api.login.and.returnValue(of(res));
    auth.login({ email: 'ana@correo.com', password: 'x' }).subscribe(() => {
      expect(tokens.getAccessToken()).toBe('acc');
      expect(tokens.hasSessionHint()).toBe(true);
      expect(session.isAuthenticated()).toBe(true);
      done();
    });
  });

  it('login "2fa_required" NO guarda tokens ni sesión', (done) => {
    const res: LoginResponseDto = { status: '2fa_required', method: 'email', preauthToken: 'pre' };
    api.login.and.returnValue(of(res));
    auth.login({ email: 'ana@correo.com', password: 'x' }).subscribe((r) => {
      expect(r.status).toBe('2fa_required');
      expect(tokens.getAccessToken()).toBeNull();
      expect(session.isAuthenticated()).toBe(false);
      done();
    });
  });

  it('signup guarda tokens y usuario', (done) => {
    const res: SignupResponseDto = { user: USER, tokens: TOKENS };
    api.signup.and.returnValue(of(res));
    auth.signup({ email: 'ana@correo.com', password: 'x', firstName: 'Ana' }).subscribe(() => {
      expect(tokens.getAccessToken()).toBe('acc');
      expect(tokens.hasSessionHint()).toBe(true);
      expect(session.isAuthenticated()).toBe(true);
      done();
    });
  });

  it('logout limpia la sesión y revoca la cookie en el backend', (done) => {
    tokens.setAccessToken('acc');
    session.setUser(USER as never);
    api.logout.and.returnValue(of(void 0));
    auth.logout().subscribe({
      complete: () => {
        expect(api.logout).toHaveBeenCalledWith(); // sin token: viaja en la cookie
        expect(tokens.getAccessToken()).toBeNull();
        expect(tokens.hasSessionHint()).toBe(false);
        expect(session.isAuthenticated()).toBe(false);
        done();
      },
    });
  });

  it('logout sin marca de sesión no llama al backend', (done) => {
    session.setUser(USER as never);
    auth.logout().subscribe({
      complete: () => {
        expect(api.logout).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('changePassword / resetPassword delegan en el SDK (síncronos)', () => {
    api.changePassword.and.returnValue(of({ message: 'ok' }) as never);
    api.resetPassword.and.returnValue(of({ message: 'ok' }) as never);
    auth.changePassword({ currentPassword: 'a', newPassword: 'bbbbbbbb' }).subscribe();
    auth.resetPassword({ token: 't', password: 'bbbbbbbb' }).subscribe();
    expect(api.changePassword).toHaveBeenCalled();
    expect(api.resetPassword).toHaveBeenCalled();
  });

  // forgotPassword pasa por el captcha (execute() es una Promesa) → es asíncrono.
  it('forgotPassword obtiene el token de captcha y delega en el SDK', (done) => {
    api.forgotPassword.and.returnValue(of({ message: 'ok' }) as never);
    auth.forgotPassword({ email: 'a@x.com' }).subscribe(() => {
      // Sin site key en test, el token es '' → el backend OMITE la verificación.
      expect(api.forgotPassword).toHaveBeenCalledWith({ email: 'a@x.com' }, '');
      done();
    });
  });
});
