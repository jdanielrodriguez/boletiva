import { input, provideZonelessChangeDetection } from '@angular/core';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AdminApi } from '../../core/api/admin.api';
import { ToastService } from '../../core/ui/toast.service';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
import { ChartComponent } from '../../shared/ui/chart.component';
import { ProfitabilityPage } from './profitability.page';

@Component({ selector: 'app-chart', standalone: true, template: '<div class="stub-chart"></div>' })
class StubChartComponent {
  readonly options = input<unknown>();
}

const row = (name: string, platformFee: string, platformPct: number) => ({
  eventId: name,
  name,
  promoterName: 'Promotora Central',
  status: 'published',
  ticketsSold: 10,
  gross: '1194.00',
  net: '1000.00',
  platformFee,
  gatewayFee: '50.00',
  iva: '120.00',
  platformPct,
});

const DATA = {
  currency: 'GTQ',
  eventsCount: 2,
  paidOrders: 4,
  ticketsSold: 20,
  gross: '2388.00',
  net: '2000.00',
  platformFee: '300.00',
  gatewayFee: '100.00',
  iva: '240.00',
  platformPct: 15,
  events: [row('Feria', '200.00', 20), row('Concierto', '100.00', 10)],
};

describe('ProfitabilityPage', () => {
  let fixture: ComponentFixture<ProfitabilityPage>;

  async function setup(profitability: () => unknown) {
    const api = {
      profitability: () => profitability(),
      exportProfitability: () => of({ body: new Blob(['x']), headers: { get: () => null } }),
    } as unknown as AdminApi;
    const toasts = { error: jasmine.createSpy('error') } as unknown as ToastService;

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        ...provideI18nTesting(),
        { provide: AdminApi, useValue: api },
        { provide: ToastService, useValue: toasts },
      ],
    });
    TestBed.overrideComponent(ProfitabilityPage, {
      remove: { imports: [ChartComponent] },
      add: { imports: [StubChartComponent] },
    });
    initI18nTesting();
    fixture = TestBed.createComponent(ProfitabilityPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const q = (sel: string) => (fixture.nativeElement as HTMLElement).querySelector(sel);

  it('pinta KPIs globales y la tabla con el % efectivo por evento', async () => {
    await setup(() => of(DATA));
    const kpis = q('[data-testid="profit-kpis"]')?.textContent ?? '';
    expect(kpis).toContain('2,388.00'); // recaudado
    expect(kpis).toContain('300.00'); // ganancia plataforma
    expect(kpis).toContain('15%'); // % efectivo
    const table = q('[data-testid="profit-table"]')?.textContent ?? '';
    expect(table).toContain('Feria');
    expect(table).toContain('20%');
    expect(table).toContain('Concierto');
    expect(table).toContain('10%');
  });

  it('estado vacío cuando no hay eventos', async () => {
    await setup(() => of({ ...DATA, events: [], eventsCount: 0 }));
    expect(q('[data-testid="profit-empty"]')).toBeTruthy();
    expect(q('[data-testid="profit-table"]')).toBeNull();
  });

  it('estado de error cuando el API falla', async () => {
    await setup(() => throwError(() => new Error('boom')));
    expect(q('[data-testid="profit-error"]')).toBeTruthy();
    expect(q('[data-testid="profit-kpis"]')).toBeNull();
  });
});
