import { input, provideZonelessChangeDetection, signal } from '@angular/core';
import { PublicConfigStore } from '../../core/config/public-config.store';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { PromoterDashboardApi } from '../../core/api/promoter-dashboard.api';
import { SessionStore } from '../../core/auth/session.store';
import { ToastService } from '../../core/ui/toast.service';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
import { ChartComponent } from '../../shared/ui/chart.component';
import { PromoterDashboardPage } from './promoter-dashboard.page';

@Component({ selector: 'app-chart', standalone: true, template: '<div class="stub-chart"></div>' })
class StubChartComponent {
  readonly options = input<unknown>();
}

const row = (key: string, label: string, extra: Partial<Record<string, unknown>> = {}) => ({
  key,
  label,
  events: 1,
  ticketsSold: 10,
  gross: '1000.00',
  net: '800.00',
  services: '150.00',
  iva: '96.00',
  refunds: '0.00',
  capacity: 100,
  checkedIn: 5,
  occupancyPct: 10,
  ...extra,
});

const DATA = {
  promoterId: 'p1',
  promoterName: 'Promotora Central',
  currency: 'GTQ',
  eventsCount: 2,
  publishedCount: 1,
  summary: {
    paidOrders: 4,
    ticketsSold: 20,
    gross: '2000.00',
    net: '1600.00',
    services: '300.00',
    platformFee: '200.00',
    gatewayFee: '100.00',
    fixedFees: '0.00',
    iva: '192.00',
    refundsCount: 1,
    refundsIssued: '150.00',
    capacity: 200,
    checkedIn: 10,
    occupancyPct: 10,
  },
  salesOverTime: [{ day: '2026-07-01', orders: 4, revenue: '2000.00' }],
  dimensions: {
    event: [row('e1', 'Concierto'), row('e2', 'Feria')],
    category: [row('c1', 'Música')],
    hall: [row('h1', 'Estadio')],
    status: [row('published', 'published'), row('finished', 'finished')],
    month: [row('2026-07', '2026-07')],
  },
};

describe('PromoterDashboardPage', () => {
  let fixture: ComponentFixture<PromoterDashboardPage>;

  async function setup(dashboard: () => unknown, isAdmin = false) {
    const api = {
      dashboard: () => dashboard(),
      export: () => of({ body: new Blob(['x']), headers: { get: () => null } }),
    } as unknown as PromoterDashboardApi;
    const session = { hasRole: (r: string) => (isAdmin ? r === 'admin' : false) } as unknown as SessionStore;
    const toasts = { error: jasmine.createSpy('error') } as unknown as ToastService;

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        ...provideI18nTesting(),
        { provide: PublicConfigStore, useValue: { reportsMaintenance: signal(false).asReadonly(), refresh: () => undefined } },
        { provide: PromoterDashboardApi, useValue: api },
        { provide: SessionStore, useValue: session },
        { provide: ToastService, useValue: toasts },
      ],
    });
    TestBed.overrideComponent(PromoterDashboardPage, {
      remove: { imports: [ChartComponent] },
      add: { imports: [StubChartComponent] },
    });
    initI18nTesting();
    fixture = TestBed.createComponent(PromoterDashboardPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const q = (sel: string) => (fixture.nativeElement as HTMLElement).querySelector(sel);

  it('pinta KPIs de rentabilidad y la tabla por evento (dimensión default)', async () => {
    await setup(() => of(DATA));
    const kpis = q('[data-testid="pdash-kpis"]')?.textContent ?? '';
    expect(kpis).toContain('2,000.00'); // recaudado
    expect(kpis).toContain('1,600.00'); // neto
    expect(kpis).toContain('10%'); // ocupación
    const table = q('[data-testid="pdash-table"]')?.textContent ?? '';
    expect(table).toContain('Concierto');
    expect(table).toContain('Feria');
  });

  it('IVA oculto para promotor (no admin)', async () => {
    await setup(() => of(DATA), false);
    const kpis = q('[data-testid="pdash-kpis"]')?.textContent ?? '';
    expect(kpis).not.toContain('192.00');
  });

  it('IVA visible para admin', async () => {
    await setup(() => of(DATA), true);
    const kpis = q('[data-testid="pdash-kpis"]')?.textContent ?? '';
    expect(kpis).toContain('192.00');
  });

  it('cambia de dimensión: al elegir Categoría muestra sus filas', async () => {
    await setup(() => of(DATA));
    const catTab = q('[data-testid="pdash-dim-category"]') as HTMLButtonElement;
    catTab.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const table = q('[data-testid="pdash-table"]')?.textContent ?? '';
    expect(table).toContain('Música');
    expect(table).not.toContain('Concierto');
  });

  it('estado: traduce las claves de estado del evento', async () => {
    await setup(() => of(DATA));
    (q('[data-testid="pdash-dim-status"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const table = q('[data-testid="pdash-table"]')?.textContent ?? '';
    expect(table).toContain('Publicado');
    expect(table).toContain('Finalizado');
  });

  it('sin ventas → vista previa (aviso + KPIs en cero, sin botón exportar)', async () => {
    await setup(() => of({ ...DATA, summary: { ...DATA.summary, paidOrders: 0 } }));
    expect(q('[data-testid="pdash-preview"]')).not.toBeNull();
    expect(q('[data-testid="pdash-kpis"]')).not.toBeNull();
    expect(q('[data-testid="pdash-export"]')).toBeNull();
  });

  it('estado de error si el endpoint falla', async () => {
    await setup(() => throwError(() => new Error('boom')));
    expect(q('[data-testid="pdash-error"]')).not.toBeNull();
  });
});
