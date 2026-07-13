import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
import { I18nService } from '../../core/i18n/i18n.service';
import { EventSettlementComponent } from './event-settlement.component';

const DATA = {
  eventId: 'e1',
  eventName: 'Show',
  currency: 'GTQ',
  paidOrders: 2,
  ticketsSold: 3,
  gross: '259.36',
  net: '200.00',
  platformFee: '20.00',
  gatewayFee: '12.96',
  fixedFees: '0.00',
  serviceFee: '32.96',
  iva: '26.40',
};

describe('EventSettlementComponent', () => {
  let fixture: ComponentFixture<EventSettlementComponent>;

  async function setup(settlement: () => unknown, showSplit = false) {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ...provideI18nTesting(),
        { provide: PromoterEventsApi, useValue: { settlement } as unknown as PromoterEventsApi },
      ],
    });
    initI18nTesting();
    fixture = TestBed.createComponent(EventSettlementComponent);
    fixture.componentRef.setInput('eventId', 'e1');
    fixture.componentRef.setInput('showSplit', showSplit);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('vista promotor: 3 líneas claras (Total recaudado / Servicios / Total del promotor)', async () => {
    await setup(() => of(DATA), false);
    const el = fixture.nativeElement as HTMLElement;
    // Total recaudado (gross), Servicios (gross − net = 59.36) y Total del promotor (net).
    expect(el.querySelector('[data-testid="settlement-gross"]')?.textContent).toContain('259.36');
    expect(el.querySelector('[data-testid="settlement-services"]')?.textContent).toContain('59.36');
    expect(el.querySelector('[data-testid="settlement-net"]')?.textContent).toContain('200.00');
    expect(el.textContent).toContain('Servicios');
    // No revela el desglose interno de comisiones al promotor.
    expect(el.textContent).not.toContain('Comisión de pasarela');
  });

  it('muestra el split completo en vista admin', async () => {
    await setup(() => of(DATA), true);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Comisión de pasarela');
    expect(el.textContent).toContain('12.96');
  });

  it('muestra error si el endpoint falla', async () => {
    await setup(() => throwError(() => new Error('x')));
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="settlement-error"]')).not.toBeNull();
  });

  it('muestra la vista por defecto (empty) sin órdenes pagadas', async () => {
    await setup(() => of({ ...DATA, paidOrders: 0, ticketsSold: 0, gross: '0.00', net: '0.00' }));
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="settlement-empty"]')).not.toBeNull();
    // No debe pintar el desglose con ceros.
    expect(el.querySelector('[data-testid="settlement-net"]')).toBeNull();
  });

  // --- i18n: cambiar el idioma traduce los textos ---
  it('traduce los textos al inglés al cambiar el idioma', async () => {
    await setup(() => of(DATA), false);
    TestBed.inject(I18nService).use('en');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    // "Neto del promotor" pasa a "Promoter net".
    expect(el.textContent).toContain('Promoter net');
  });
});
