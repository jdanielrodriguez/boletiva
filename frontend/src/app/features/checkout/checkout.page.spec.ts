import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import { OrderStreamEvent, OrderStreamService } from '../../core/api/order-stream.service';
import { SessionStore } from '../../core/auth/session.store';
import { UsersApi } from '../../core/api/users.api';
import { BillingApi } from '../../core/api/billing.api';
import { OrdersApi } from '../../core/api/orders.api';
import { PaymentMethodsApi } from '../../core/api/payment-methods.api';
import { WalletApi } from '../../core/api/wallet.api';
import { I18nService } from '../../core/i18n/i18n.service';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
import type {
  OrderResponseDto,
  PaymentMethodResponseDto,
  PaymentOptionsResponseDto,
  PayOrderResponseDto,
  WalletBalanceResponseDto,
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
  let methods: jasmine.SpyObj<PaymentMethodsApi>;
  let walletApi: jasmine.SpyObj<WalletApi>;
  let sse: Subject<OrderStreamEvent>;

  /** Llena el form de tarjeta nueva con datos válidos (Luhn) para habilitar Pagar (M1). */
  function fillNewCard(): void {
    const set = (id: string, v: string) => {
      const input = el.querySelector(id) as HTMLInputElement;
      input.value = v;
      input.dispatchEvent(new Event('input'));
    };
    set('#cc-number', '4242 4242 4242 4242');
    set('#cc-exp', '12/30');
    set('#cc-cvv', '123');
    set('#cc-name', 'Test User');
    fixture.detectChanges();
  }

  async function setup(
    opts: { cards?: PaymentMethodResponseDto[]; balance?: string } = {},
  ) {
    orders = jasmine.createSpyObj<OrdersApi>('OrdersApi', ['get', 'paymentOptions', 'pay']);
    orders.get.and.returnValue(of(ORDER as unknown as OrderResponseDto));
    orders.paymentOptions.and.returnValue(of(OPTIONS as unknown as PaymentOptionsResponseDto));
    orders.pay.and.returnValue(of({ status: 'pending' } as unknown as PayOrderResponseDto));
    methods = jasmine.createSpyObj<PaymentMethodsApi>('PaymentMethodsApi', ['list']);
    methods.list.and.returnValue(of((opts.cards ?? []) as PaymentMethodResponseDto[]));
    walletApi = jasmine.createSpyObj<WalletApi>('WalletApi', ['balance']);
    walletApi.balance.and.returnValue(
      of({ balance: opts.balance ?? '0.00', currency: 'GTQ' } as WalletBalanceResponseDto),
    );
    sse = new Subject<OrderStreamEvent>();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        ...provideI18nTesting(),
        { provide: OrdersApi, useValue: orders },
        { provide: PaymentMethodsApi, useValue: methods },
        { provide: WalletApi, useValue: walletApi },
        { provide: OrderStreamService, useValue: { stream: () => sse.asObservable() } },
        { provide: SessionStore, useValue: { user: () => null } },
        { provide: UsersApi, useValue: { markTourSeen: () => of({}) } },
        { provide: BillingApi, useValue: { nitName: () => of({ available: false, name: null }) } },
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

  afterEach(() => fixture?.destroy());

  const CARDS: PaymentMethodResponseDto[] = [
    { id: 'c1', brand: 'visa', last4: '4242', isDefault: true, createdAt: '2026-01-01T00:00:00Z' },
  ];

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
    fillNewCard();
    const select = el.querySelector('.installments select') as HTMLSelectElement;
    select.value = '3';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    (el.querySelector('[data-testid="pay-confirm"]') as HTMLButtonElement).click();
    expect(orders.pay).toHaveBeenCalledWith('o1', {
      gatewayId: 'gw1',
      installments: 3,
      useWallet: false,
      billingNit: undefined,
      billingName: undefined,
    });
  });

  it('preselecciona la pasarela ASIGNADA al evento (recommended) aunque no sea la default', async () => {
    const twoGateways = {
      ...OPTIONS,
      eventGatewayId: 'gw2',
      gateways: [
        { ...OPTIONS.gateways[0], gatewayId: 'gw1', isPlatformDefault: true, recommended: false },
        {
          gatewayId: 'gw2',
          name: 'Pagalo',
          provider: 'pagalo',
          isPlatformDefault: false,
          recommended: true,
          total: '129.68',
          serviceFee: '16.48',
          installmentOptions: [{ installments: 1, total: '129.68', serviceFee: '16.48' }],
        },
      ],
    };
    orders = jasmine.createSpyObj<OrdersApi>('OrdersApi', ['get', 'paymentOptions', 'pay']);
    orders.get.and.returnValue(of(ORDER as unknown as OrderResponseDto));
    orders.paymentOptions.and.returnValue(
      of(twoGateways as unknown as PaymentOptionsResponseDto),
    );
    orders.pay.and.returnValue(of({ status: 'pending' } as unknown as PayOrderResponseDto));
    methods = jasmine.createSpyObj<PaymentMethodsApi>('PaymentMethodsApi', ['list']);
    methods.list.and.returnValue(of([] as PaymentMethodResponseDto[]));
    walletApi = jasmine.createSpyObj<WalletApi>('WalletApi', ['balance']);
    walletApi.balance.and.returnValue(of({ balance: '0.00', currency: 'GTQ' } as WalletBalanceResponseDto));
    sse = new Subject<OrderStreamEvent>();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        ...provideI18nTesting(),
        { provide: OrdersApi, useValue: orders },
        { provide: PaymentMethodsApi, useValue: methods },
        { provide: WalletApi, useValue: walletApi },
        { provide: OrderStreamService, useValue: { stream: () => sse.asObservable() } },
        { provide: SessionStore, useValue: { user: () => null } },
        { provide: UsersApi, useValue: { markTourSeen: () => of({}) } },
        { provide: BillingApi, useValue: { nitName: () => of({ available: false, name: null }) } },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ orderId: 'o1' })) } },
      ],
    });
    initI18nTesting();
    fixture = TestBed.createComponent(CheckoutPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
    // La opción marcada como recomendada (gw2) queda seleccionada; su badge se muestra.
    const selected = el.querySelector('.gateway-option.selected .gateway-name');
    expect(selected?.textContent).toContain('Pagalo');
    fillNewCard();
    (el.querySelector('[data-testid="pay-confirm"]') as HTMLButtonElement).click();
    expect(orders.pay).toHaveBeenCalledWith('o1', {
      gatewayId: 'gw2',
      installments: 1,
      useWallet: false,
      billingNit: undefined,
      billingName: undefined,
    });
  });

  it('tras enviar el pago muestra el loading continuo mientras sigue pendiente', async () => {
    await setup();
    fillNewCard();
    expect(el.querySelector('[data-testid="checkout-confirming"]')).toBeNull();
    (el.querySelector('[data-testid="pay-confirm"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    // La petición retornó (status sigue 'pending') → el overlay de carga toma el relevo.
    expect(el.querySelector('[data-testid="checkout-confirming"]')).not.toBeNull();
    // Al confirmarse (SSE paid) desaparece el loading y aparece el splash.
    sse.next({ type: 'order', data: { status: 'paid' } });
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="checkout-confirming"]')).toBeNull();
    expect(el.querySelector('[data-testid="status-paid"]')).not.toBeNull();
  });

  it('el SSE confirma el pago (pending → paid) sin polling', async () => {
    await setup();
    expect(el.querySelector('[data-testid="status-paid"]')).toBeNull();
    sse.next({ type: 'order', data: { status: 'paid' } });
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="status-paid"]')).not.toBeNull();
  });

  it('sin métodos guardados muestra el formulario de tarjeta nueva (flujo anterior)', async () => {
    await setup({ cards: [] });
    expect(el.querySelector('[data-testid="new-card-form"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="no-methods-hint"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="pay-saved-card"]')).toBeNull();
  });

  it('con métodos guardados los ofrece para seleccionar y NO muestra el form por defecto', async () => {
    await setup({ cards: CARDS });
    expect(el.querySelector('[data-testid="pay-saved-card"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="new-card-form"]')).toBeNull();
    // La tarjeta default queda seleccionada → pide CVV.
    expect(el.querySelector('[data-testid="cvv-block"]')).not.toBeNull();
  });

  it('pagar con tarjeta guardada exige CVV válido antes de confirmar', async () => {
    await setup({ cards: CARDS });
    const payBtn = el.querySelector('[data-testid="pay-confirm"]') as HTMLButtonElement;
    // Sin CVV → deshabilitado.
    expect(payBtn.disabled).toBe(true);
    const cvv = el.querySelector('[data-testid="saved-cvv"]') as HTMLInputElement;
    cvv.value = '123';
    cvv.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect((el.querySelector('[data-testid="pay-confirm"]') as HTMLButtonElement).disabled).toBe(false);
    (el.querySelector('[data-testid="pay-confirm"]') as HTMLButtonElement).click();
    expect(orders.pay).toHaveBeenCalledWith('o1', {
      gatewayId: 'gw1',
      installments: 1,
      useWallet: false,
      billingNit: undefined,
      billingName: undefined,
    });
  });

  it('con saldo suficiente permite pagar con wallet (useWallet=true, sin pasarela)', async () => {
    await setup({ balance: '200.00' });
    (el.querySelector('[data-testid="pay-wallet"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    // El saldo cubre el total → oculta la selección de pasarela.
    expect(el.querySelector('.gateway-options')).toBeNull();
    (el.querySelector('[data-testid="pay-confirm"]') as HTMLButtonElement).click();
    expect(orders.pay).toHaveBeenCalledWith('o1', {
      gatewayId: 'gw1',
      installments: 1,
      useWallet: true,
      billingNit: undefined,
      billingName: undefined,
    });
  });

  it('al confirmarse el pago (SSE paid) muestra el mensaje y el enlace a boletos', async () => {
    await setup({ cards: CARDS });
    sse.next({ type: 'order', data: { status: 'paid' } });
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="splash-redirect"]')).not.toBeNull();
    const link = el.querySelector('[data-testid="go-to-tickets"]') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toContain('/cuenta');
  });

  it('traduce la interfaz al inglés al cambiar de idioma', async () => {
    await setup();
    expect(el.querySelector('h1')?.textContent).toContain('Pago');
    TestBed.inject(I18nService).use('en');
    fixture.detectChanges();
    expect(el.querySelector('h1')?.textContent).toContain('Payment');
    expect(el.querySelector('[data-testid="pay-confirm"]')?.textContent).toContain('Pay');
  });

  it('el enlace a boletos apunta a la compra específica', async () => {
    await setup();
    TestBed.inject(Router);
    sse.next({ type: 'order', data: { status: 'paid' } });
    fixture.detectChanges();
    const link = el.querySelector('[data-testid="go-to-tickets"]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toContain('order=o1');
  });
});
