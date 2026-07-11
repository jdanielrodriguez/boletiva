import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideI18nTesting } from '../../core/i18n/testing';
import { API_BASE_URL } from '../../core/config/api.tokens';
import { MaintenanceStore } from '../../core/maintenance/maintenance.store';
import { MaintenanceBannerComponent } from './maintenance-banner.component';

const BASE = 'http://api.test/api/v1';

describe('MaintenanceBannerComponent', () => {
  let fixture: ComponentFixture<MaintenanceBannerComponent>;
  let el: HTMLElement;
  let mock: HttpTestingController;
  let store: MaintenanceStore;

  async function setup() {
    TestBed.configureTestingModule({
      providers: [
        ...provideI18nTesting(),
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE },
      ],
    });
    mock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(MaintenanceStore);
    store.markEnabled('activo');
    fixture = TestBed.createComponent(MaintenanceBannerComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  afterEach(() => mock.verify());

  it('renderiza el banner con el botón de desactivar', async () => {
    await setup();
    expect(el.querySelector('[data-testid="maintenance-banner"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="maintenance-disable"]')).not.toBeNull();
  });

  it('al desactivar llama al API y marca el estado como desactivado', async () => {
    await setup();
    (el.querySelector('[data-testid="maintenance-disable"]') as HTMLButtonElement).click();
    const req = mock.expectOne(`${BASE}/admin/maintenance`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ enabled: false });
    req.flush({ enabled: false, message: null });
    await fixture.whenStable();
    expect(store.enabled()).toBe(false);
  });
});
