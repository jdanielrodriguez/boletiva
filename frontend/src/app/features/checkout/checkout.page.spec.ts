import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { Subject, of } from 'rxjs';
import { OrderStreamEvent, OrderStreamService } from '../../core/api/order-stream.service';
import { OrdersApi } from '../../core/api/orders.api';
import { I18nService } from '../../core/i18n/i18n.service';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
import type {
  OrderResponseDto,
  PaymentOptionsResponseDto,
  PayOrderResponseDto,
} from '../../core/api/types';
import { CheckoutPage } from './checkout.page';

const ORDER = {
  id: 'o1',
  status: 'pending',
  currency: 'GTQ',
  net: '100.00',
  iva: '13.20',
  total: '129.68',
  gatewayFee: '16.48',
};
const OPTIONS = {
  orderId: 'o1',
  currency: 'GTQ',
  absorbedByPromoter: false,
  gateways: [
    {
      gatewayId: 'gw1',
      name: 'Recurrente',
      provider: 'recurrente',
      isPlatformDefault: true,
      total: '129.68',
      serviceFee: '16.48',
      installmentOptions: [
        { installments: 1, total: '129.68', serviceFee: '16.48' },
        { installments: 3, total: '129.68', serviceFee: '18.00' },
      ],
    },
  ],
};

describe('CheckoutPage', () => {
  let fixture: ComponentFixture<CheckoutPage>;
  let el: HTMLElement;
  let orders: jasmine.SpyObj<OrdersApi>;
  let sse: Subject<OrderStreamEvent>;

  async function setup() {
    orders = jasmine.createSpyObj<OrdersApi>('OrdersApi', ['get', 'paymentOptions', 'pay']);
    orders.get.and.returnValue(of(ORDER as unknown as OrderResponseDto));
    orders.paymentOptions.and.returnValue(of(OPTIONS as unknown as PaymentOptionsResponseDto));
    orders.pay.and.returnValue(of({ status: 'pending' } as unknown as PayOrderResponseDto));
    sse = new Subject<OrderStreamEvent>();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ...provideI18nTesting(),
        { provide: OrdersApi, useValue: orders },
        { provide: OrderStreamService, useValue: { stream: () => sse.asObservable() } },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ orderId: 'o1' })) } },
      ],
    });
    initI18nTesting();
    fixture = TestBed.createComponent(CheckoutPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  it('muestra el desglose transparente (boleto + serviceFee + IVA = total)', async () => {
    await setup();
    expect(el.querySelector('[data-testid="service-fee"]')?.textContent).toContain('16.48');
    expect(el.querySelector('[data-testid="total"]')?.textContent).toContain('129.68');
  });

  it('cambiar a cuotas actualiza la cuota por servicio', async () => {
    await setup();
    const select = el.querySelector('.installments select') as HTMLSelectElement;
    select.value = '3';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="service-fee"]')?.textContent).toContain('18.00');
  });

  it('pagar invoca pay con pasarela y cuotas elegidas', async () => {
    await setup();
    const select = el.querySelector('.installments select') as HTMLSelectElement;
    select.value = '3';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    (el.querySelector('[data-testid="pay-confirm"]') as HTMLButtonElement).click();
    expect(orders.pay).toHaveBeenCalledWith('o1', {
      gatewayId: 'gw1',
      installments: 3,
      useWallet: false,
    });
  });

  it('el SSE confirma el pago (pending → paid) sin polling', async () => {
    await setup();
    expect(el.querySelector('[data-testid="status-paid"]')).toBeNull();
    sse.next({ type: 'order', data: { status: 'paid' } });
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="status-paid"]')).not.toBeNull();
  });

  it('traduce la interfaz al inglés al cambiar de idioma', async () => {
    await setup();
    expect(el.querySelector('h1')?.textContent).toContain('Pago');
    TestBed.inject(I18nService).use('en');
    fixture.detectChanges();
    expect(el.querySelector('h1')?.textContent).toContain('Payment');
    expect(el.querySelector('[data-testid="pay-confirm"]')?.textContent).toContain('Pay');
  });
});
