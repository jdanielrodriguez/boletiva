import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
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
        { provide: PromoterEventsApi, useValue: { settlement } as unknown as PromoterEventsApi },
      ],
    });
    fixture = TestBed.createComponent(EventSettlementComponent);
    fixture.componentRef.setInput('eventId', 'e1');
    fixture.componentRef.setInput('showSplit', showSplit);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('muestra el neto y la cuota por servicio (vista promotor)', async () => {
    await setup(() => of(DATA), false);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="settlement-net"]')?.textContent).toContain('200.00');
    expect(el.textContent).toContain('Cuota por servicio');
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
    expect(el.querySelector('.error')).not.toBeNull();
  });
});
