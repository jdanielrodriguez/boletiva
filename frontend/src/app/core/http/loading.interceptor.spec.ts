import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LoadingStore } from '../ui/loading.store';
import { silentContext } from './http-context';
import { loadingInterceptor } from './loading.interceptor';

const BASE = 'http://api.test/api/v1';

describe('loadingInterceptor', () => {
  let http: HttpClient;
  let mock: HttpTestingController;
  let store: LoadingStore;

  beforeEach(() => {
    jasmine.clock().install();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(withInterceptors([loadingInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    mock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(LoadingStore);
  });

  afterEach(() => {
    mock.verify();
    jasmine.clock().uninstall();
  });

  it('muestra el overlay tras el debounce mientras hay una petición en vuelo', () => {
    http.get(`${BASE}/orders`).subscribe();
    const req = mock.expectOne(`${BASE}/orders`);

    // Antes del debounce no se muestra (evita parpadeo).
    expect(store.visible()).toBe(false);
    jasmine.clock().tick(200);
    expect(store.visible()).toBe(true);

    // Al completar la petición se oculta de inmediato.
    req.flush({});
    expect(store.visible()).toBe(false);
  });

  it('NO parpadea si la petición termina antes del debounce', () => {
    http.get(`${BASE}/orders`).subscribe();
    const req = mock.expectOne(`${BASE}/orders`);
    req.flush({});
    jasmine.clock().tick(500);
    expect(store.visible()).toBe(false);
  });

  it('se oculta también cuando la petición falla', () => {
    http.get(`${BASE}/orders`).subscribe({ error: () => undefined });
    const req = mock.expectOne(`${BASE}/orders`);
    jasmine.clock().tick(200);
    expect(store.visible()).toBe(true);
    req.flush(null, { status: 500, statusText: 'Server Error' });
    expect(store.visible()).toBe(false);
  });

  it('sigue visible hasta que TODAS las peticiones concurrentes terminan', () => {
    http.get(`${BASE}/a`).subscribe();
    http.get(`${BASE}/b`).subscribe();
    const a = mock.expectOne(`${BASE}/a`);
    const b = mock.expectOne(`${BASE}/b`);
    jasmine.clock().tick(200);
    expect(store.visible()).toBe(true);
    a.flush({});
    expect(store.visible()).toBe(true);
    b.flush({});
    expect(store.visible()).toBe(false);
  });

  it('IGNORA las peticiones silenciosas (no oscurece la pantalla)', () => {
    http.get(`${BASE}/maintenance`, { context: silentContext() }).subscribe();
    const req = mock.expectOne(`${BASE}/maintenance`);
    jasmine.clock().tick(300);
    expect(store.visible()).toBe(false);
    req.flush({});
  });
});
