import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../config/api.tokens';
import { TokenStore } from '../auth/token-store.service';
import { authInterceptor } from './auth.interceptor';

const BASE = 'http://api.test/api/v1';

describe('authInterceptor', () => {
  let http: HttpClient;
  let mock: HttpTestingController;
  let tokens: TokenStore;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE },
      ],
    });
    http = TestBed.inject(HttpClient);
    mock = TestBed.inject(HttpTestingController);
    tokens = TestBed.inject(TokenStore);
  });

  afterEach(() => {
    mock.verify();
    localStorage.clear();
  });

  it('adjunta el Bearer a peticiones del API', () => {
    tokens.setTokens('acc', 'ref');
    http.get(`${BASE}/orders`).subscribe();
    const req = mock.expectOne(`${BASE}/orders`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer acc');
    req.flush({});
  });

  it('NO adjunta el Bearer a hosts externos', () => {
    tokens.setTokens('acc', 'ref');
    http.get('http://tercero.test/x').subscribe();
    const req = mock.expectOne('http://tercero.test/x');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('ante 401 refresca y reintenta con el token nuevo', (done) => {
    tokens.setTokens('old', 'ref');
    http.get(`${BASE}/orders`).subscribe((res) => {
      expect(res).toEqual({ ok: true });
      done();
    });

    const first = mock.expectOne((r) => r.url === `${BASE}/orders`);
    expect(first.request.headers.get('Authorization')).toBe('Bearer old');
    first.flush(null, { status: 401, statusText: 'Unauthorized' });

    const refresh = mock.expectOne(`${BASE}/auth/refresh`);
    refresh.flush({ accessToken: 'new', refreshToken: 'ref2' });

    const retry = mock.expectOne((r) => r.url === `${BASE}/orders`);
    expect(retry.request.headers.get('Authorization')).toBe('Bearer new');
    retry.flush({ ok: true });
  });

  it('ante 401 sin refresh token, propaga el error sin refrescar', (done) => {
    // Sin tokens en absoluto.
    http.get(`${BASE}/orders`).subscribe({
      error: (err) => {
        expect(err.status).toBe(401);
        done();
      },
    });
    const req = mock.expectOne(`${BASE}/orders`);
    req.flush(null, { status: 401, statusText: 'Unauthorized' });
    mock.expectNone(`${BASE}/auth/refresh`);
  });

  it('no intenta refrescar el propio 401 del refresh', (done) => {
    tokens.setTokens('old', 'ref');
    http.post(`${BASE}/auth/refresh`, { refreshToken: 'ref' }).subscribe({
      error: (err) => {
        expect(err.status).toBe(401);
        done();
      },
    });
    const req = mock.expectOne(`${BASE}/auth/refresh`);
    req.flush(null, { status: 401, statusText: 'Unauthorized' });
    // No debe haber un segundo /auth/refresh.
    mock.expectNone(`${BASE}/auth/refresh`);
  });
});
