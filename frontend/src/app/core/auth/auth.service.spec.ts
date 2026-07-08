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
};
const TOKENS: TokenPairResponseDto = { accessToken: 'acc', refreshToken: 'ref', expiresIn: 900 };

describe('AuthService', () => {
  let auth: AuthService;
  let tokens: TokenStore;
  let session: SessionStore;
  let api: jasmine.SpyObj<AuthApi>;

  beforeEach(() => {
    localStorage.clear();
    api = jasmine.createSpyObj<AuthApi>('AuthApi', ['login', 'verify2fa', 'signup', 'logout']);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: AuthApi, useValue: api },
        { provide: ApiClient, useValue: { get: () => of(null), post: () => of(null) } },
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
      expect(tokens.getRefreshToken()).toBe('ref');
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
      expect(tokens.getRefreshToken()).toBe('ref');
      expect(session.isAuthenticated()).toBe(true);
      done();
    });
  });

  it('logout limpia la sesión y revoca el refresh en el backend', (done) => {
    tokens.setTokens('acc', 'ref');
    session.setUser(USER as never);
    api.logout.and.returnValue(of(void 0));
    auth.logout().subscribe({
      complete: () => {
        expect(api.logout).toHaveBeenCalledWith('ref');
        expect(tokens.getRefreshToken()).toBeNull();
        expect(session.isAuthenticated()).toBe(false);
        done();
      },
    });
  });
});
