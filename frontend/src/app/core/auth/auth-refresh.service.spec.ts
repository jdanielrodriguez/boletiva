import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../config/api.tokens';
import { AuthRefreshService, AuthTokens } from './auth-refresh.service';
import { TokenStore } from './token-store.service';

const BASE = 'http://api.test/api/v1';

describe('AuthRefreshService', () => {
  let mock: HttpTestingController;
  let svc: AuthRefreshService;
  let tokens: TokenStore;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE },
      ],
    });
    mock = TestBed.inject(HttpTestingController);
    svc = TestBed.inject(AuthRefreshService);
    tokens = TestBed.inject(TokenStore);
  });
  afterEach(() => {
    mock.verify();
    localStorage.clear();
  });

  it('sin marca de sesión no pega al backend y devuelve null', (done) => {
    expect(tokens.hasSessionHint()).toBe(false);
    svc.refresh().subscribe((t) => {
      expect(t).toBeNull();
      done();
    });
    mock.expectNone(svc.refreshUrl);
  });

  it('con sesión: refresca, guarda el nuevo access token y marca sesión', (done) => {
    tokens.markSession();
    svc.refresh().subscribe((t) => {
      expect((t as AuthTokens).accessToken).toBe('new-access');
      expect(tokens.getAccessToken()).toBe('new-access');
      expect(tokens.hasSessionHint()).toBe(true);
      done();
    });
    const req = mock.expectOne(svc.refreshUrl);
    expect(req.request.method).toBe('POST');
    expect(req.request.withCredentials).toBe(true);
    req.flush({ accessToken: 'new-access' });
  });

  it('deduplica: dos llamadas concurrentes comparten UN solo refresh en vuelo', (done) => {
    tokens.markSession();
    const results: (AuthTokens | null)[] = [];
    svc.refresh().subscribe((t) => results.push(t));
    svc.refresh().subscribe((t) => {
      results.push(t);
      expect(results.length).toBe(2);
      expect(results[0]).toBe(results[1]);
      done();
    });
    // Una sola petición HTTP a pesar de las dos suscripciones.
    const req = mock.expectOne(svc.refreshUrl);
    req.flush({ accessToken: 'shared' });
  });

  it('permite un nuevo refresh una vez el anterior terminó (finalize limpia inFlight)', (done) => {
    tokens.markSession();
    svc.refresh().subscribe((t) => expect((t as AuthTokens).accessToken).toBe('first'));
    // El flush completa el primer refresh de forma síncrona → finalize limpia inFlight.
    mock.expectOne(svc.refreshUrl).flush({ accessToken: 'first' });

    svc.refresh().subscribe((t) => {
      expect((t as AuthTokens).accessToken).toBe('second');
      done();
    });
    mock.expectOne(svc.refreshUrl).flush({ accessToken: 'second' });
  });

  it('en error (refresh inválido/reuso) limpia la sesión y propaga el error', (done) => {
    tokens.markSession();
    tokens.setAccessToken('stale');
    svc.refresh().subscribe({
      next: () => fail('no debería emitir'),
      error: () => {
        expect(tokens.getAccessToken()).toBeNull();
        expect(tokens.hasSessionHint()).toBe(false);
        done();
      },
    });
    mock.expectOne(svc.refreshUrl).flush(
      { message: 'reuse detected' },
      { status: 401, statusText: 'Unauthorized' },
    );
  });
});
