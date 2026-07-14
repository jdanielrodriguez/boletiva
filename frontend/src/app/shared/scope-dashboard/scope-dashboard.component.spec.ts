import { Component, input, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HallsApi } from '../../core/api/halls.api';
import { SeatTemplatesApi } from '../../core/api/seat-templates.api';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
import { ChartComponent } from '../ui/chart.component';
import { ScopeDashboardComponent } from './scope-dashboard.component';

@Component({ selector: 'app-chart', standalone: true, template: '<div class="stub-chart"></div>' })
class StubChartComponent {
  readonly options = input<unknown>();
}

const DATA = {
  scope: 'hall',
  id: 'h1',
  name: 'Estadio Nacional',
  currency: 'GTQ',
  eventsCount: 3,
  publishedCount: 2,
  summary: { paidOrders: 5, ticketsSold: 42, gross: '5000.00', net: '4000.00', services: '1000.00', iva: '480.00' },
  salesOverTime: [{ day: '2026-07-01', orders: 5, revenue: '5000.00' }],
  occupancy: { totalCapacity: 300, totalSold: 42, occupancyPct: 14 },
  topEvents: [
    { eventId: 'e1', name: 'Concierto', status: 'published', ticketsSold: 30, gross: '3500.00' },
    { eventId: 'e2', name: 'Feria', status: 'finished', ticketsSold: 12, gross: '1500.00' },
  ],
};

describe('ScopeDashboardComponent', () => {
  let fixture: ComponentFixture<ScopeDashboardComponent>;

  async function setup(kind: 'hall' | 'template', result: () => unknown) {
    const halls = { dashboard: () => result() } as unknown as HallsApi;
    const templates = { dashboard: () => result() } as unknown as SeatTemplatesApi;
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ...provideI18nTesting(),
        { provide: HallsApi, useValue: halls },
        { provide: SeatTemplatesApi, useValue: templates },
      ],
    });
    TestBed.overrideComponent(ScopeDashboardComponent, {
      remove: { imports: [ChartComponent] },
      add: { imports: [StubChartComponent] },
    });
    initI18nTesting();
    fixture = TestBed.createComponent(ScopeDashboardComponent);
    fixture.componentRef.setInput('kind', kind);
    fixture.componentRef.setInput('id', 'h1');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('salón: nombre, KPIs y tabla de top eventos', async () => {
    await setup('hall', () => of(DATA));
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="scope-name"]')?.textContent).toContain('Estadio Nacional');
    const kpis = el.querySelector('[data-testid="scope-kpis"]')?.textContent ?? '';
    expect(kpis).toContain('5,000.00'); // recaudado (money pipe: separador de miles)
    expect(kpis).toContain('4,000.00'); // neto
    expect(kpis).toContain('14%'); // ocupación
    const top = el.querySelector('[data-testid="scope-top"]')?.textContent ?? '';
    expect(top).toContain('Concierto');
    expect(top).toContain('Feria');
  });

  it('sin ventas → vista previa: aviso + dashboard en cero (KPIs visibles)', async () => {
    await setup('template', () => of({ ...DATA, summary: { ...DATA.summary, paidOrders: 0 } }));
    expect(fixture.nativeElement.querySelector('[data-testid="scope-preview"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="scope-kpis"]')).not.toBeNull();
  });

  it('estado de error si el endpoint falla', async () => {
    await setup('hall', () => throwError(() => new Error('boom')));
    expect(fixture.nativeElement.querySelector('[data-testid="scope-error"]')).not.toBeNull();
  });
});
