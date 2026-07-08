import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../config/api.tokens';
import { ApiClient } from './api-client.service';

const BASE = 'http://api.test/api/v1';

describe('ApiClient', () => {
  let api: ApiClient;
  let mock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE },
      ],
    });
    api = TestBed.inject(ApiClient);
    mock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => mock.verify());

  it('prefija la base y normaliza el slash inicial', () => {
    api.get('/events').subscribe();
    mock.expectOne(`${BASE}/events`).flush({});
    api.get('events').subscribe();
    mock.expectOne(`${BASE}/events`).flush({});
  });

  it('omite params undefined/null y serializa el resto', () => {
    api.get('/events', { skip: 0, take: 20, q: undefined, cursor: null }).subscribe();
    const req = mock.expectOne((r) => r.url === `${BASE}/events`);
    expect(req.request.params.get('skip')).toBe('0');
    expect(req.request.params.get('take')).toBe('20');
    expect(req.request.params.has('q')).toBe(false);
    expect(req.request.params.has('cursor')).toBe(false);
    req.flush({});
  });

  it('post envía el cuerpo', () => {
    api.post('/auth/login', { email: 'a@b.c' }).subscribe();
    const req = mock.expectOne(`${BASE}/auth/login`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'a@b.c' });
    req.flush({});
  });
});
