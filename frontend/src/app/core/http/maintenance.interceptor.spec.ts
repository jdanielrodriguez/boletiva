import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../config/api.tokens';
import { MaintenanceStore } from '../maintenance/maintenance.store';
import { maintenanceInterceptor } from './maintenance.interceptor';

const BASE = 'http://api.test/api/v1';

describe('maintenanceInterceptor', () => {
  let http: HttpClient;
  let mock: HttpTestingController;
  let store: MaintenanceStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(withInterceptors([maintenanceInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE },
      ],
    });
    http = TestBed.inject(HttpClient);
    mock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(MaintenanceStore);
  });

  afterEach(() => mock.verify());

  it('ante 503 del API marca el mantenimiento activo con su mensaje', (done) => {
    http.get(`${BASE}/orders`).subscribe({
      error: () => {
        expect(store.enabled()).toBe(true);
        expect(store.message()).toBe('Volvemos pronto');
        done();
      },
    });
    const req = mock.expectOne(`${BASE}/orders`);
    req.flush(
      { statusCode: 503, error: 'Service Unavailable', message: 'Volvemos pronto' },
      { status: 503, statusText: 'Service Unavailable' },
    );
  });

  it('otros errores (500) NO activan mantenimiento', (done) => {
    http.get(`${BASE}/orders`).subscribe({
      error: () => {
        expect(store.enabled()).toBe(false);
        done();
      },
    });
    mock.expectOne(`${BASE}/orders`).flush(null, { status: 500, statusText: 'Server Error' });
  });

  it('un 503 de un host externo NO activa mantenimiento', (done) => {
    http.get('http://tercero.test/x').subscribe({
      error: () => {
        expect(store.enabled()).toBe(false);
        done();
      },
    });
    mock.expectOne('http://tercero.test/x').flush(null, { status: 503, statusText: 'Unavailable' });
  });
});
