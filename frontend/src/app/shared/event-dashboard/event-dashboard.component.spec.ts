import { Component, input, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
import { ChartComponent } from '../ui/chart.component';
import { EventDashboardComponent } from './event-dashboard.component';

/** Stub de la gráfica: evita cargar ApexCharts (browser-only) en los tests. */
@Component({ selector: 'app-chart', standalone: true, template: '<div class="stub-chart"></div>' })
class StubChartComponent {
  readonly options = input<unknown>();
}

const DATA = {
  eventId: 'e1',
  eventName: 'Show',
  currency: 'GTQ',
  status: 'published',
  startsAt: '2027-05-01T00:00:00.000Z',
  endsAt: '2027-05-01T04:00:00.000Z',
  summary: {
    eventId: 'e1',
    eventName: 'Show',
    currency: 'GTQ',
    paidOrders: 2,
    ticketsSold: 3,
    gross: '389.60',
    net: '300.00',
    platformFee: '30.00',
    gatewayFee: '20.00',
    fixedFees: '0.00',
    serviceFee: '50.00',
    services: '89.60',
    iva: '39.60',
    refundsIssued: '0.00',
  },
  salesOverTime: [{ day: '2026-07-01', orders: 2, revenue: '389.60' }],
  occupancy: {
    totalCapacity: 150,
    totalSold: 3,
    occupancyPct: 2,
    byLocality: [
      { localityId: 'g', name: 'General', kind: 'general', capacity: 100, sold: 2, occupancyPct: 2 },
      { localityId: 'v', name: 'VIP', kind: 'seated', capacity: 50, sold: 1, occupancyPct: 2 },
    ],
  },
  attendance: { totalTickets: 3, valid: 1, used: 1, transferred: 0, revoked: 1, checkedInPct: 50 },
};

describe('EventDashboardComponent', () => {
  let fixture: ComponentFixture<EventDashboardComponent>;

  async function setup(dashboard: () => unknown, showSplit = false) {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ...provideI18nTesting(),
        { provide: PromoterEventsApi, useValue: { dashboard } as unknown as PromoterEventsApi },
      ],
    });
    TestBed.overrideComponent(EventDashboardComponent, {
      remove: { imports: [ChartComponent] },
      add: { imports: [StubChartComponent] },
    });
    initI18nTesting();
    fixture = TestBed.createComponent(EventDashboardComponent);
    fixture.componentRef.setInput('eventId', 'e1');
    fixture.componentRef.setInput('showSplit', showSplit);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('vista promotor: KPIs (recaudado, neto, ocupación, check-in) + tabla de ocupación', async () => {
    await setup(() => of(DATA), false);
    const el = fixture.nativeElement as HTMLElement;
    const kpis = el.querySelector('[data-testid="dash-kpis"]')?.textContent ?? '';
    expect(kpis).toContain('389.60'); // recaudado
    expect(kpis).toContain('300.00'); // neto
    expect(kpis).toContain('2%'); // ocupación
    expect(kpis).toContain('50%'); // check-in
    // Tabla de ocupación con las dos localidades y el total.
    const occ = el.querySelector('[data-testid="dash-occupancy"]')?.textContent ?? '';
    expect(occ).toContain('General');
    expect(occ).toContain('VIP');
    // Asistencia con los conteos por estado.
    const att = el.querySelector('[data-testid="dash-attendance"]')?.textContent ?? '';
    expect(att).toContain('1');
    // Vista promotor NO muestra el KPI de IVA (solo admin).
    expect(el.textContent).not.toContain('39.60');
  });

  it('vista admin: agrega los KPIs de servicios e IVA', async () => {
    await setup(() => of(DATA), true);
    const kpis = fixture.nativeElement.querySelector('[data-testid="dash-kpis"]')?.textContent ?? '';
    expect(kpis).toContain('89.60'); // servicios (gross − net)
    expect(kpis).toContain('39.60'); // IVA
  });

  it('estado vacío cuando no hay órdenes pagadas', async () => {
    await setup(() => of({ ...DATA, summary: { ...DATA.summary, paidOrders: 0 } }), false);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="dash-empty"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="dash-kpis"]')).toBeNull();
  });

  it('estado de error si el endpoint falla', async () => {
    await setup(() => throwError(() => new Error('boom')), false);
    expect(fixture.nativeElement.querySelector('[data-testid="dash-error"]')).not.toBeNull();
  });
});
