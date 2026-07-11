import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../config/api.tokens';
import { MaintenanceStore } from './maintenance.store';

const BASE = 'http://api.test/api/v1';

describe('MaintenanceStore', () => {
  let store: MaintenanceStore;
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
    store = TestBed.inject(MaintenanceStore);
    mock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => mock.verify());

  it('parte de no-mantenimiento y no-cargado', () => {
    expect(store.enabled()).toBe(false);
    expect(store.loaded()).toBe(false);
    expect(store.active()).toBe(false);
  });

  it('load() aplica el estado del backend', () => {
    store.load();
    mock.expectOne(`${BASE}/maintenance`).flush({ enabled: true, message: 'En obras' });
    expect(store.enabled()).toBe(true);
    expect(store.message()).toBe('En obras');
    expect(store.loaded()).toBe(true);
    expect(store.active()).toBe(true);
  });

  it('load() con fallo asume no-mantenimiento pero marca cargado', () => {
    store.load();
    mock.expectOne(`${BASE}/maintenance`).flush(null, { status: 500, statusText: 'err' });
    expect(store.enabled()).toBe(false);
    expect(store.loaded()).toBe(true);
  });

  it('markEnabled/markDisabled alternan el estado', () => {
    store.markEnabled('caído');
    expect(store.active()).toBe(true);
    expect(store.message()).toBe('caído');
    store.markDisabled();
    expect(store.enabled()).toBe(false);
    expect(store.message()).toBeNull();
  });
});
