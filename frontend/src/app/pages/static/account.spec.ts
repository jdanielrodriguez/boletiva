import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { OrdersApi } from '../../core/api/orders.api';
import { TicketsApi } from '../../core/api/tickets.api';
import { TransfersApi } from '../../core/api/transfers.api';
import { UsersApi } from '../../core/api/users.api';
import { WalletApi } from '../../core/api/wallet.api';
import type { TicketPageResponseDto, WalletBalanceResponseDto } from '../../core/api/types';
import { AuthService } from '../../core/auth/auth.service';
import { SessionStore } from '../../core/auth/session.store';
import { ToastService } from '../../core/ui/toast.service';
import { Account } from './account';

const TICKETS = {
  items: [
    { id: 't1', serial: 'PE-1', status: 'valid', eventId: 'e1', orderId: 'o1', localityName: 'VIP', seatLabel: 'A1', mediaReady: true, event: { name: 'Fiesta' } },
    { id: 't3', serial: 'PE-3', status: 'valid', eventId: 'e1', orderId: 'o2', localityName: 'General', mediaReady: true, event: { name: 'Fiesta' } },
    { id: 't2', serial: 'PE-2', status: 'used', eventId: 'e2', orderId: 'o3', localityName: 'General', event: { name: 'Concierto' } },
  ],
} as unknown as TicketPageResponseDto;

interface Overrides {
  wallet?: Record<string, unknown>;
  tickets?: Record<string, unknown>;
  orders?: Record<string, unknown>;
  transfers?: Record<string, unknown>;
  users?: Record<string, unknown>;
  auth?: Record<string, unknown>;
  section?: string;
}

describe('Account (mi cuenta)', () => {
  let fixture: ComponentFixture<Account>;
  let el: HTMLElement;
  let setUser: jasmine.Spy;
  let toasts: ToastService;

  async function setup(o: Overrides = {}) {
    setUser = jasmine.createSpy('setUser');
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        ToastService,
        {
          provide: WalletApi,
          useValue: {
            balance: () => of({ balance: '50.00', currency: 'GTQ' } as WalletBalanceResponseDto),
            withdrawals: () => of({ items: [], nextCursor: null }),
            requestWithdrawal: () => of({}),
            cancelWithdrawal: () => of({}),
            ...o.wallet,
          } as unknown as WalletApi,
        },
        { provide: TicketsApi, useValue: { list: () => of(TICKETS), media: () => of({}), transfer: () => of({}), ...o.tickets } as unknown as TicketsApi },
        { provide: OrdersApi, useValue: { list: () => of({ items: [], nextCursor: null }), ledgerChain: () => of({ orderId: 'o1', transactions: [], chainValid: true }), ...o.orders } as unknown as OrdersApi },
        { provide: TransfersApi, useValue: { claim: () => of({}), outgoing: () => of([]), cancel: () => of({}), ...o.transfers } as unknown as TransfersApi },
        { provide: UsersApi, useValue: { updateMe: () => of({ firstName: 'Ana' }), ...o.users } as unknown as UsersApi },
        { provide: AuthService, useValue: { changePassword: () => of({ message: 'ok' }), ...o.auth } as unknown as AuthService },
        {
          provide: SessionStore,
          useValue: {
            user: () => ({ firstName: 'Ana', lastName: 'P', email: 'ana@correo.com' }),
            setUser,
          },
        },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(o.section ? { s: o.section } : {}) } },
        },
      ],
    });
    fixture = TestBed.createComponent(Account);
    toasts = TestBed.inject(ToastService);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const go = (testid: string) => {
    (el.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement).click();
    fixture.detectChanges();
  };

  const lastToast = () => toasts.toasts().at(-1);

  it('perfil muestra el correo del usuario', async () => {
    await setup();
    expect(el.textContent).toContain('ana@correo.com');
  });

  it('guardar perfil llama updateMe, refresca la sesión y notifica con toast', async () => {
    const updateMe = jasmine.createSpy('updateMe').and.returnValue(of({ firstName: 'Nuevo' }));
    await setup({ users: { updateMe } });
    go('save-profile');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(updateMe).toHaveBeenCalled();
    expect(setUser).toHaveBeenCalled();
    expect(lastToast()?.kind).toBe('success');
  });

  it('guardar perfil con error muestra toast de error', async () => {
    const updateMe = jasmine.createSpy('updateMe').and.returnValue(throwError(() => new Error('x')));
    await setup({ users: { updateMe } });
    go('save-profile');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(lastToast()?.kind).toBe('error');
  });

  it('cambiar contraseña valida que coincida la confirmación (toast warning)', async () => {
    await setup();
    fixture.componentInstance['currentPassword'].set('Password123');
    fixture.componentInstance['newPassword'].set('NuevaClave456');
    fixture.componentInstance['confirmPassword'].set('otra');
    go('change-password');
    expect(lastToast()?.kind).toBe('warning');
  });

  it('cambiar contraseña llama al API y notifica éxito', async () => {
    const changePassword = jasmine.createSpy('cp').and.returnValue(of({ message: 'ok' }));
    await setup({ auth: { changePassword } });
    fixture.componentInstance['currentPassword'].set('Password123');
    fixture.componentInstance['newPassword'].set('NuevaClave456');
    fixture.componentInstance['confirmPassword'].set('NuevaClave456');
    go('change-password');
    expect(changePassword).toHaveBeenCalledWith({ currentPassword: 'Password123', newPassword: 'NuevaClave456' });
    expect(lastToast()?.kind).toBe('success');
  });

  it('cambiar contraseña con error del backend muestra toast de error', async () => {
    const changePassword = jasmine.createSpy('cp').and.returnValue(throwError(() => new Error('bad')));
    await setup({ auth: { changePassword } });
    fixture.componentInstance['currentPassword'].set('malActual');
    fixture.componentInstance['newPassword'].set('NuevaClave456');
    fixture.componentInstance['confirmPassword'].set('NuevaClave456');
    go('change-password');
    expect(lastToast()?.kind).toBe('error');
  });

  it('wallet muestra el saldo', async () => {
    await setup();
    go('menu-wallet');
    expect(el.querySelector('[data-testid="wallet-balance"]')?.textContent).toContain('50.00');
  });

  it('deep-link ?s=wallet abre directo la sección wallet', async () => {
    await setup({ section: 'wallet' });
    expect(el.querySelector('[data-testid="wallet-balance"]')).not.toBeNull();
  });

  it('wallet explicita el origen del saldo (reembolsos/reventas, no recarga con tarjeta)', async () => {
    await setup();
    go('menu-wallet');
    const note = el.querySelector('[data-testid="wallet-source"]')?.textContent ?? '';
    expect(note).toContain('reembolsos');
    expect(note).toContain('reventas');
    expect(note.toLowerCase()).toContain('tarjeta');
  });

  it('solicitar retiro sin monto muestra toast warning', async () => {
    await setup();
    go('menu-wallet');
    go('request-withdrawal');
    expect(lastToast()?.kind).toBe('warning');
  });

  it('wallet muestra preview de comisión/neto al ingresar monto', async () => {
    await setup();
    go('menu-wallet');
    fixture.componentInstance['withdrawAmount'].set(100);
    fixture.detectChanges();
    const preview = el.querySelector('[data-testid="withdraw-preview"]')?.textContent ?? '';
    expect(preview).toContain('6%'); // usuario sin rol promotor → 6%
    expect(preview).toContain('94.00'); // neto estimado 100 - 6%
  });

  it('wallet: ver transacción navega a facturación con la orden', async () => {
    await setup({ orders: { list: () => of({ items: [{ id: 'o9', total: '129.68', status: 'paid', createdAt: '2026-07-01' }], nextCursor: null }) } });
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    go('menu-wallet');
    await fixture.whenStable();
    fixture.detectChanges();
    go('wallet-ver-transaccion');
    expect(nav).toHaveBeenCalledWith(['/cuenta'], { queryParams: { s: 'facturacion', order: 'o9' } });
  });

  it('solicitar retiro con monto llama al API y notifica', async () => {
    const requestWithdrawal = jasmine.createSpy('req').and.returnValue(of({}));
    await setup({ wallet: { requestWithdrawal } });
    go('menu-wallet');
    fixture.componentInstance['withdrawAmount'].set(100);
    go('request-withdrawal');
    expect(requestWithdrawal).toHaveBeenCalledWith({ amount: 100 });
    expect(lastToast()?.kind).toBe('success');
  });

  it('boletos activos lista solo los válidos (no usados)', async () => {
    await setup();
    go('menu-activos');
    const list = el.querySelector('[data-testid="tickets-activos"]');
    expect(list?.textContent).toContain('Fiesta');
    expect(list?.textContent).not.toContain('Concierto'); // usado → va a pasados
  });

  it('boletos activos se agrupan por evento y por compra (cards)', async () => {
    await setup();
    go('menu-activos');
    const cont = el.querySelector('[data-testid="tickets-activos"]');
    expect(cont?.querySelectorAll('.event-card').length).toBe(1); // un solo evento (e1)
    expect(cont?.querySelectorAll('.order-block').length).toBe(2); // dos compras (o1, o2)
    expect(cont?.textContent).toContain('VIP');
    expect(cont?.textContent).toContain('Asiento A1');
  });

  it('ver compra navega a facturación filtrando la orden', async () => {
    await setup();
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    go('menu-activos');
    go('ver-compra');
    expect(nav).toHaveBeenCalledWith(['/cuenta'], { queryParams: { s: 'facturacion', order: 'o1' } });
    expect(fixture.componentInstance['orderFilter']()).toBe('o1');
  });

  it('transferir un boleto muestra el código a compartir', async () => {
    const transfer = jasmine.createSpy('transfer').and.returnValue(of({ code: 'K7MNPQ23' }));
    await setup({ tickets: { list: () => of(TICKETS), media: () => of({}), transfer } });
    go('menu-activos');
    go('ticket-transfer');
    expect(transfer).toHaveBeenCalledWith('t1');
    expect(el.querySelector('[data-testid="transfer-code"]')?.textContent).toContain('K7MNPQ23');
  });

  it('el QR se muestra por defecto (auto-carga la media al abrir activos)', async () => {
    const media = jasmine.createSpy('media').and.returnValue(of({ qrUrl: 'http://x/qr.png', pdfUrl: 'http://x/p.pdf' }));
    await setup({ tickets: { list: () => of(TICKETS), media, transfer: () => of({}) } });
    go('menu-activos');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(media).toHaveBeenCalledWith('t1');
    expect(el.querySelector('.ticket-media img')?.getAttribute('src')).toContain('qr.png');
  });

  it('el botón alterna la visibilidad del QR (Ocultar/Ver)', async () => {
    const media = jasmine.createSpy('media').and.returnValue(of({ qrUrl: 'http://x/qr.png', pdfUrl: 'http://x/p.pdf' }));
    await setup({ tickets: { list: () => of(TICKETS), media, transfer: () => of({}) } });
    go('menu-activos');
    await fixture.whenStable();
    fixture.detectChanges();
    const firstCard = el.querySelector('.ticket-card') as HTMLElement;
    const btn = firstCard.querySelector('[data-testid="ticket-media"]') as HTMLButtonElement;
    expect(btn.textContent).toContain('Ocultar QR'); // visible por defecto
    expect(firstCard.querySelector('.ticket-media img')).not.toBeNull();
    btn.click();
    fixture.detectChanges();
    expect(btn.textContent).toContain('Ver QR'); // ocultado
    expect(firstCard.querySelector('.ticket-media img')).toBeNull();
  });

  it('media no lista muestra toast warning', async () => {
    const media = jasmine.createSpy('media').and.returnValue(throwError(() => new Error('nope')));
    await setup({ tickets: { list: () => of(TICKETS), media, transfer: () => of({}) } });
    go('menu-activos');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(lastToast()?.kind).toBe('warning');
  });

  it('facturación vacía muestra estado vacío', async () => {
    await setup();
    go('menu-facturacion');
    expect(el.querySelector('[data-testid="orders-empty"]')).not.toBeNull();
  });

  const ORDERS = [
    { id: 'o1', eventId: 'e1', event: { name: 'Fiesta' }, status: 'paid', total: '129.68', createdAt: '2026-07-01T10:00:00Z', billingNit: 'CF', items: [{ id: 'i1', label: 'A1', total: '129.68', locality: { name: 'VIP' } }] },
    { id: 'o2', eventId: 'e2', event: { name: 'Concierto' }, status: 'cancelled', total: '50.00', createdAt: '2026-07-02T10:00:00Z', billingNit: 'CF', items: [{ id: 'i2', label: null, total: '50.00', locality: { name: 'General' } }] },
  ];

  it('facturación lista compras con evento, localidad y total', async () => {
    await setup({ orders: { list: () => of({ items: ORDERS, nextCursor: null }) } });
    go('menu-facturacion');
    const list = el.querySelector('[data-testid="orders-list"]');
    expect(list?.textContent).toContain('Fiesta');
    expect(list?.textContent).toContain('VIP');
    expect(list?.textContent).toContain('129.68');
  });

  it('facturación filtra por estado', async () => {
    await setup({ orders: { list: () => of({ items: ORDERS, nextCursor: null }) } });
    go('menu-facturacion');
    fixture.componentInstance['filterStatus'].set('cancelled');
    fixture.detectChanges();
    const list = el.querySelector('[data-testid="orders-list"]');
    expect(list?.textContent).toContain('Concierto');
    expect(list?.textContent).not.toContain('Fiesta');
  });

  it('facturación: filtro sin coincidencias muestra vacío', async () => {
    await setup({ orders: { list: () => of({ items: ORDERS, nextCursor: null }) } });
    go('menu-facturacion');
    fixture.componentInstance['filterEvent'].set('inexistente');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="orders-filtered-empty"]')).not.toBeNull();
  });

  it('deep-link con ?order filtra una sola compra y permite limpiar', async () => {
    await setup({ section: 'facturacion', orders: { list: () => of({ items: ORDERS, nextCursor: null }) } });
    // Forzamos el filtro por orden (deep-link) manualmente.
    fixture.componentInstance['orderFilter'].set('o2');
    fixture.detectChanges();
    const list = el.querySelector('[data-testid="orders-list"]');
    expect(list?.textContent).toContain('Concierto');
    expect(list?.textContent).not.toContain('Fiesta');
    go('clear-order-filter');
    expect(fixture.componentInstance['orderFilter']()).toBeNull();
  });

  it('facturación muestra la cadena blockchain al pedirla', async () => {
    const chain = { orderId: 'o1', chainValid: true, transactions: [{ seq: '1', kind: 'order_payment', createdAt: '2026-07-01', hash: 'abcdef0123456789', prevHash: '', verified: true }] };
    const ledgerChain = jasmine.createSpy('lc').and.returnValue(of(chain));
    await setup({ orders: { list: () => of({ items: ORDERS, nextCursor: null }), ledgerChain } });
    go('menu-facturacion');
    go('toggle-chain');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(ledgerChain).toHaveBeenCalledWith('o1');
    const chainEl = el.querySelector('[data-testid="ledger-chain"]');
    expect(chainEl?.textContent).toContain('íntegra');
    expect(chainEl?.textContent).toContain('order_payment');
  });

  it('facturación: error al cargar la cadena muestra toast', async () => {
    const ledgerChain = jasmine.createSpy('lc').and.returnValue(throwError(() => new Error('x')));
    await setup({ orders: { list: () => of({ items: ORDERS, nextCursor: null }), ledgerChain } });
    go('menu-facturacion');
    go('toggle-chain');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(lastToast()?.kind).toBe('error');
  });
});
