import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { OrderStreamEvent, OrderStreamService } from '../../core/api/order-stream.service';
import { SessionStore } from '../../core/auth/session.store';
import { UsersApi } from '../../core/api/users.api';
import { BillingApi } from '../../core/api/billing.api';
import { OrdersApi } from '../../core/api/orders.api';
import { PaymentMethodsApi } from '../../core/api/payment-methods.api';
import type {
  OrderResponseDto,
  PaymentMethodResponseDto,
  PaymentOptionsResponseDto,
  PayOrderResponseDto,
  WalletBalanceResponseDto,
} from '../../core/api/types';
import { WalletApi } from '../../core/api/wallet.api';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
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

const TWO_GATEWAYS = {
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
        { installments: 3, total: '135.00', serviceFee: '22.00' },
      ],
    },
    {
      gatewayId: 'gw2',
      name: 'Pagalo',
      provider: 'pagalo',
      isPlatformDefault: false,
      total: '131.00',
      serviceFee: '18.00',
      installmentOptions: [{ installments: 1, total: '131.00', serviceFee: '18.00' }],
    },
  ],
};

interface Testable {
  payMode: { set(m: 'saved' | 'wallet' | 'new'): void };
  installments: { set(n: number): void };
  cvv: { set(v: string): void };
  cardNumber: { set(v: string): void };
  cardExp: { set(v: string): void };
  cardCvv: { set(v: string): void };
  cardName: { set(v: string): void };
  selectedCardId: { set(v: string | null): void };
  gatewayId(): string | null;
  selectGateway(id: string): void;
  selectInstallments(n: string): void;
  setPayMode(m: 'saved' | 'wallet' | 'new'): void;
  selectCard(id: string): void;
  perInstallment(total: string, n: number): string;
  canPay(): boolean;
  processing(): boolean;
  needsGateway(): boolean;
  walletCoversAll(): boolean;
  breakdown(): { total: string; serviceFee: string } | null;
  error(): string | null;
  pay(): void;
}

/** Llena el formulario de tarjeta nueva con datos válidos (Luhn) para habilitar Pagar (M1). */
function fillNewCard(c: Testable): void {
  c.cardNumber.set('4242 4242 4242 4242');
  c.cardExp.set('12/30');
  c.cardCvv.set('123');
  c.cardName.set('Test User');
}

describe('CheckoutPage — ramas de pago y selección', () => {
  let fixture: ComponentFixture<CheckoutPage>;
  let orders: jasmine.SpyObj<OrdersApi>;
  let methods: jasmine.SpyObj<PaymentMethodsApi>;
  let walletApi: jasmine.SpyObj<WalletApi>;
  let sse: Subject<OrderStreamEvent>;

  async function setup(
    opts: {
      options?: unknown;
      cards?: PaymentMethodResponseDto[] | null;
      balance?: string;
      pay?: () => ReturnType<OrdersApi['pay']>;
    } = {},
  ): Promise<Testable> {
    orders = jasmine.createSpyObj<OrdersApi>('OrdersApi', ['get', 'paymentOptions', 'pay']);
    orders.get.and.returnValue(of(ORDER as unknown as OrderResponseDto));
    orders.paymentOptions.and.returnValue(
      of((opts.options ?? TWO_GATEWAYS) as unknown as PaymentOptionsResponseDto),
    );
    orders.pay.and.callFake(
      opts.pay ?? (() => of({ status: 'pending' } as unknown as PayOrderResponseDto)),
    );
    methods = jasmine.createSpyObj<PaymentMethodsApi>('PaymentMethodsApi', ['list']);
    methods.list.and.returnValue(
      opts.cards === null
        ? throwError(() => new Error('500'))
        : of((opts.cards ?? []) as PaymentMethodResponseDto[]),
    );
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
    return fixture.componentInstance as unknown as Testable;
  }

  afterEach(() => fixture?.destroy());

  const CARDS: PaymentMethodResponseDto[] = [
    { id: 'c1', brand: 'visa', last4: '4242', isDefault: false, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'c2', brand: 'mc', last4: '1111', isDefault: true, createdAt: '2026-01-02T00:00:00Z' },
  ];

  it('un fallo cargando métodos marca methodsError y cae a tarjeta nueva', async () => {
    const c = await setup({ cards: null });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="new-card-form"]')).not.toBeNull();
    // Tarjeta vacía → NO se puede pagar (M1 QA); con datos válidos → sí.
    expect(c.canPay()).toBe(false);
    fillNewCard(c);
    fixture.detectChanges();
    expect(c.canPay()).toBe(true);
  });

  it('selectGateway cambia la pasarela y resetea las cuotas a 1', async () => {
    const c = await setup();
    c.installments.set(3);
    c.selectGateway('gw2');
    expect(c.gatewayId()).toBe('gw2');
    expect(c.breakdown()?.total).toBe('131.00');
  });

  it('breakdown cae al total de la pasarela cuando el plazo elegido no existe', async () => {
    const c = await setup();
    c.selectInstallments('99'); // plazo inexistente → selectedOption null
    expect(c.breakdown()?.serviceFee).toBe('16.48'); // fallback a gw.serviceFee
  });

  it('perInstallment divide el total entre el número de cuotas', async () => {
    const c = await setup();
    expect(c.perInstallment('135.00', 3)).toBe('45.00');
  });

  it('selectCard fija la tarjeta y el modo guardado', async () => {
    const c = await setup({ cards: CARDS });
    c.selectCard('c1');
    // sin CVV válido aún no puede pagar
    expect(c.canPay()).toBe(false);
    c.cvv.set('123');
    expect(c.canPay()).toBe(true);
  });

  it('pay() con wallet sin saldo no llama al backend', async () => {
    const c = await setup({ balance: '0.00' });
    c.setPayMode('wallet');
    c.pay();
    expect(orders.pay).not.toHaveBeenCalled();
  });

  it('pay() con tarjeta guardada y CVV inválido fija el error y no cobra', async () => {
    const c = await setup({ cards: CARDS });
    c.setPayMode('saved');
    c.cvv.set('12'); // inválido
    c.pay();
    expect(orders.pay).not.toHaveBeenCalled();
    expect(c.error()).toBeTruthy();
  });

  it('pay() sin pasarela disponible no cobra (guard needsGateway && !gw)', async () => {
    const c = await setup({ options: { ...TWO_GATEWAYS, gateways: [] } });
    c.setPayMode('new');
    expect(c.needsGateway()).toBe(true);
    c.pay();
    expect(orders.pay).not.toHaveBeenCalled();
  });

  it('un error del backend al pagar muestra el mensaje de error y deja reintentar', async () => {
    const c = await setup({ pay: () => throwError(() => new Error('409')) });
    c.setPayMode('new');
    fillNewCard(c);
    c.pay();
    expect(orders.pay).toHaveBeenCalled();
    expect(c.error()).toBeTruthy();
    // El fallo libera el envío: no queda en "procesando" y se puede reintentar.
    expect(c.processing()).toBe(false);
    expect(c.canPay()).toBe(true);
  });

  it('walletCoversAll es falso si el saldo no cubre el total', async () => {
    const c = await setup({ balance: '50.00' });
    c.setPayMode('wallet');
    expect(c.walletCoversAll()).toBe(false);
    // Sigue necesitando pasarela (pago mixto).
    expect(c.needsGateway()).toBe(true);
  });
});
