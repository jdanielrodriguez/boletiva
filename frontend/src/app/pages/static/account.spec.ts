import { HttpHeaders, HttpResponse } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { OrdersApi } from '../../core/api/orders.api';
import { PaymentMethodsApi } from '../../core/api/payment-methods.api';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { TicketsApi } from '../../core/api/tickets.api';
import { TransfersApi } from '../../core/api/transfers.api';
import { UsersApi } from '../../core/api/users.api';
import { WalletApi } from '../../core/api/wallet.api';
import type { TicketPageResponseDto, WalletBalanceResponseDto } from '../../core/api/types';
import { AuthService } from '../../core/auth/auth.service';
import { AuthApi } from '../../core/api/auth.api';
import { SessionStore } from '../../core/auth/session.store';
import { I18nService } from '../../core/i18n/i18n.service';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
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
  authApi?: Record<string, unknown>;
  cardsApi?: Record<string, unknown>;
  promoterEvents?: Record<string, unknown>;
  section?: string;
  /** Roles del usuario en sesión (default buyer). Los vendedores ven los retiros. */
  roles?: string[];
}

describe('Account (mi cuenta)', () => {
  let fixture: ComponentFixture<Account>;
  let el: HTMLElement;
  let setUser: jasmine.Spy;
  let toasts: ToastService;

  async function setup(o: Overrides = {}) {
    setUser = jasmine.createSpy('setUser');
    const roles = o.roles ?? ['buyer'];
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        ...provideI18nTesting(),
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
        { provide: OrdersApi, useValue: { list: () => of({ items: [], nextCursor: null }), movements: () => of({ items: [] }), ledgerChain: () => of({ orderId: 'o1', transactions: [], chainValid: true }), eventLedgerChain: () => of({ eventId: 'e1', transactions: [], chainValid: true }), ...o.orders } as unknown as OrdersApi },
        { provide: TransfersApi, useValue: { claim: () => of({}), outgoing: () => of([]), cancel: () => of({}), ...o.transfers } as unknown as TransfersApi },
        {
          provide: PromoterEventsApi,
          useValue: {
            exportSettlement: () =>
              of(
                new HttpResponse<Blob>({
                  body: new Blob(['x'], {
                    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  }),
                  headers: new HttpHeaders({
                    'content-disposition': 'attachment; filename="liquidacion-evento.xlsx"',
                  }),
                }),
              ),
            ...o.promoterEvents,
          } as unknown as PromoterEventsApi,
        },
        { provide: UsersApi, useValue: { updateMe: () => of({ firstName: 'Ana' }), ...o.users } as unknown as UsersApi },
        {
          provide: PaymentMethodsApi,
          useValue: {
            list: () => of([]),
            add: () => of({ id: 'c1', brand: 'visa', last4: '4242', isDefault: true }),
            setDefault: () => of({}),
            remove: () => of({ deleted: true }),
            ...o.cardsApi,
          } as unknown as PaymentMethodsApi,
        },
        { provide: AuthService, useValue: { changePassword: () => of({ message: 'ok' }), ...o.auth } as unknown as AuthService },
        {
          provide: AuthApi,
          useValue: {
            totpSetup: () => of({ otpauthUrl: 'otpauth://x', qrDataUrl: 'data:image/png;base64,x', secret: 'ABC' }),
            totpEnable: () => of({ message: 'ok' }),
            useEmail2fa: () => of({ message: 'ok' }),
            me: () => of({ twoFactorMethod: 'email' }),
            ...o.authApi,
          } as unknown as AuthApi,
        },
        {
          provide: SessionStore,
          useValue: {
            user: () => ({ firstName: 'Ana', lastName: 'P', email: 'ana@correo.com', roles, toursSeen: ['account'] }),
            setUser,
            hasAnyRole: (rs: string[]) => rs.some((r) => roles.includes(r)),
            hasRole: (r: string) => roles.includes(r),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            // El componente se suscribe a queryParamMap (deep-link reactivo). El
            // snapshot se mantiene por compatibilidad.
            queryParamMap: of(convertToParamMap(o.section ? { s: o.section } : {})),
            snapshot: { queryParamMap: convertToParamMap(o.section ? { s: o.section } : {}) },
          },
        },
      ],
    });
    initI18nTesting();
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

  it('B-02: alta de TOTP pide la contraseña (step-up) ANTES de generar el QR', async () => {
    const totpSetup = jasmine
      .createSpy('totpSetup')
      .and.returnValue(of({ otpauthUrl: 'otpauth://x', qrDataUrl: 'data:image/png;base64,x', secret: 'ABC' }));
    await setup({ authApi: { totpSetup, me: () => of({ twoFactorMethod: 'email' }) } });
    (el.querySelector('[data-testid="twofa-start-totp"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    // Paso de contraseña visible y SIN llamar al backend todavía.
    expect(el.querySelector('[data-testid="twofa-password"]')).not.toBeNull();
    expect(totpSetup).not.toHaveBeenCalled();
    // Ingresa la contraseña → continúa → llama totpSetup(password) y muestra el QR.
    (fixture.componentInstance as unknown as { totpPassword: { set: (v: string) => void } }).totpPassword.set('Password123');
    fixture.detectChanges();
    (el.querySelector('[data-testid="twofa-password-submit"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(totpSetup).toHaveBeenCalledWith('Password123');
    expect(el.querySelector('[data-testid="twofa-qr"]')).not.toBeNull();
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

  it('el icono (i) del wallet abre el modal informativo del origen del saldo', async () => {
    await setup();
    go('menu-wallet');
    expect(el.querySelector('[data-testid="wallet-info-modal"]')).toBeNull();
    go('wallet-source-tip');
    const modal = el.querySelector('[data-testid="wallet-info-modal"]');
    expect(modal).not.toBeNull();
    // Cliente: menciona devoluciones/reventas y que NO se recarga con tarjeta.
    expect(modal?.textContent?.toLowerCase()).toContain('devolución');
    expect(modal?.textContent?.toLowerCase()).toContain('reventa');
    go('wallet-info-close');
    expect(el.querySelector('[data-testid="wallet-info-modal"]')).toBeNull();
  });

  it('CLIENTE (buyer) NO ve retiros ni el formulario, pero SÍ ve el saldo', async () => {
    await setup({ roles: ['buyer'] });
    go('menu-wallet');
    expect(el.querySelector('[data-testid="wallet-balance"]')?.textContent).toContain('50.00');
    // Sin retiros ni solicitud: el backend responde 403 a un buyer.
    expect(el.querySelector('[data-testid="request-withdrawal"]')).toBeNull();
    expect(el.querySelector('[data-testid="withdrawals-empty"]')).toBeNull();
    expect(el.querySelector('[data-testid="withdrawals-list"]')).toBeNull();
    // Pero sí conserva la mini-facturación de movimientos.
    expect(el.querySelector('[data-testid="wallet-orders-empty"]')).not.toBeNull();
  });

  it('PROMOTOR sí ve el formulario de solicitar retiro', async () => {
    await setup({ roles: ['promoter'] });
    go('menu-wallet');
    expect(el.querySelector('[data-testid="request-withdrawal"]')).not.toBeNull();
  });

  it('solicitar retiro sin monto muestra toast warning', async () => {
    await setup({ roles: ['promoter'] });
    go('menu-wallet');
    go('request-withdrawal');
    expect(lastToast()?.kind).toBe('warning');
  });

  it('wallet muestra preview de comisión/neto al ingresar monto', async () => {
    await setup({ roles: ['promoter'] });
    go('menu-wallet');
    fixture.componentInstance['withdrawAmount'].set(100);
    fixture.detectChanges();
    const preview = el.querySelector('[data-testid="withdraw-preview"]')?.textContent ?? '';
    expect(preview).toContain('3%'); // promotor → 3%
    expect(preview).toContain('97.00'); // neto estimado 100 - 3%
  });

  it('wallet: ver transacción navega a la vista de detalle de la orden', async () => {
    await setup({ orders: { list: () => of({ items: [{ id: 'o9', total: '129.68', status: 'paid', createdAt: '2026-07-01' }], nextCursor: null }) } });
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    go('menu-wallet');
    await fixture.whenStable();
    fixture.detectChanges();
    go('wallet-ver-transaccion');
    expect(nav).toHaveBeenCalledWith(['/cuenta/transaccion', 'o9']);
  });

  it('solicitar retiro con monto llama al API y notifica', async () => {
    const requestWithdrawal = jasmine.createSpy('req').and.returnValue(of({}));
    await setup({ roles: ['promoter'], wallet: { requestWithdrawal } });
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
    expect(cont?.textContent).toContain('A1'); // localidad · asiento en el título del póster
  });

  it('ver compra navega a la vista de detalle de la transacción', async () => {
    await setup();
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    go('menu-activos');
    go('ver-compra');
    expect(nav).toHaveBeenCalledWith(['/cuenta/transaccion', 'o1']);
  });

  it('transferir un boleto abre el asistente (info → confirmar → código a compartir)', async () => {
    const transfer = jasmine.createSpy('transfer').and.returnValue(of({ code: 'K7MNPQ23' }));
    await setup({ tickets: { list: () => of(TICKETS), media: () => of({}), transfer } });
    go('menu-activos');
    // 1) Abre el modal de instrucciones; aún NO transfiere.
    go('ticket-transfer');
    expect(el.querySelector('[data-testid="transfer-modal"]')).not.toBeNull();
    expect(transfer).not.toHaveBeenCalled();
    // 2) Confirmar → transfiere y muestra el código.
    go('transfer-confirm');
    expect(transfer).toHaveBeenCalledWith('t1');
    expect(el.querySelector('[data-testid="transfer-code"]')?.textContent).toContain('K7MNPQ23');
  });

  it('cancelar el asistente de transferencia no transfiere', async () => {
    const transfer = jasmine.createSpy('transfer').and.returnValue(of({ code: 'K7MNPQ23' }));
    await setup({ tickets: { list: () => of(TICKETS), media: () => of({}), transfer } });
    go('menu-activos');
    go('ticket-transfer');
    go('transfer-cancel');
    expect(el.querySelector('[data-testid="transfer-modal"]')).toBeNull();
    expect(transfer).not.toHaveBeenCalled();
  });

  it('el QR se muestra por defecto (auto-carga la media al abrir activos)', async () => {
    const media = jasmine.createSpy('media').and.returnValue(of({ qrUrl: 'http://x/qr.png', pdfUrl: 'http://x/p.pdf' }));
    await setup({ tickets: { list: () => of(TICKETS), media, transfer: () => of({}) } });
    go('menu-activos');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(media).toHaveBeenCalledWith('t1');
    expect(el.querySelector('.poster-qr img')?.getAttribute('src')).toContain('qr.png');
  });

  it('el botón alterna la visibilidad del QR (Ocultar/Ver)', async () => {
    const media = jasmine.createSpy('media').and.returnValue(of({ qrUrl: 'http://x/qr.png', pdfUrl: 'http://x/p.pdf' }));
    await setup({ tickets: { list: () => of(TICKETS), media, transfer: () => of({}) } });
    go('menu-activos');
    await fixture.whenStable();
    fixture.detectChanges();
    const firstCard = el.querySelector('.poster-ticket') as HTMLElement;
    const btn = firstCard.querySelector('[data-testid="ticket-media"]') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Ocultar QR'); // visible por defecto
    expect(firstCard.querySelector('.poster-qr img')).not.toBeNull();
    btn.click();
    fixture.detectChanges();
    expect(btn.getAttribute('aria-label')).toBe('Ver QR'); // ocultado
    expect(firstCard.querySelector('.poster-qr img')).toBeNull();
  });

  it('media no lista muestra toast warning', async () => {
    const media = jasmine.createSpy('media').and.returnValue(throwError(() => new Error('nope')));
    await setup({ tickets: { list: () => of(TICKETS), media, transfer: () => of({}) } });
    go('menu-activos');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(lastToast()?.kind).toBe('warning');
  });

  it('métodos: sin tarjetas muestra estado vacío BONITO (empty-state) y botón agregar', async () => {
    await setup();
    go('menu-metodos');
    const empty = el.querySelector('[data-testid="cards-empty"]');
    expect(empty).not.toBeNull();
    // Es el componente empty-state (ilustración + título), no una sola línea gris.
    expect(empty?.querySelector('.empty-illustration')).not.toBeNull();
    expect(empty?.querySelector('.empty-title')).not.toBeNull();
    expect(el.querySelector('[data-testid="add-method"]')).not.toBeNull();
  });

  it('wallet: sin retiros muestra estado vacío BONITO (empty-state)', async () => {
    await setup({ roles: ['promoter'] });
    go('menu-wallet');
    const empty = el.querySelector('[data-testid="withdrawals-empty"]');
    expect(empty).not.toBeNull();
    expect(empty?.querySelector('.empty-illustration')).not.toBeNull();
    expect(empty?.querySelector('.empty-title')).not.toBeNull();
  });

  it('métodos: lista las tarjetas guardadas (sin datos sensibles)', async () => {
    const list = () => of([{ id: 'c1', brand: 'visa', last4: '4242', isDefault: true, createdAt: '2026-07-01' }]);
    await setup({ cardsApi: { list } });
    go('menu-metodos');
    const listEl = el.querySelector('[data-testid="cards-list"]');
    expect(listEl?.textContent).toContain('4242');
    expect(listEl?.textContent?.toLowerCase()).toContain('predeterminada');
  });

  it('métodos: guardar tarjeta tokeniza en cliente y NO envía el PAN al backend', async () => {
    const add = jasmine.createSpy('add').and.returnValue(of({ id: 'c1', brand: 'visa', last4: '4242', isDefault: true }));
    await setup({ cardsApi: { add } });
    go('menu-metodos');
    go('add-method');
    fixture.componentInstance['cardNumber'].set('4242424242424242');
    fixture.componentInstance['cardExpMonth'].set('12');
    fixture.componentInstance['cardExpYear'].set('28');
    fixture.componentInstance['cardCvc'].set('123');
    fixture.detectChanges(); // habilita el botón (cardFormValid) antes de hacer click
    go('save-card');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(add).toHaveBeenCalled();
    const body = add.calls.mostRecent().args[0] as Record<string, unknown>;
    expect(body['brand']).toBe('visa');
    expect(body['last4']).toBe('4242');
    expect(body['nonce']).toMatch(/^nonce_/);
    // El PAN NUNCA viaja al backend.
    expect(JSON.stringify(body)).not.toContain('4242424242424242');
    expect(lastToast()?.kind).toBe('success');
  });

  it('métodos: con número inválido el botón Guardar queda deshabilitado y no llama al backend', async () => {
    const add = jasmine.createSpy('add').and.returnValue(of({}));
    await setup({ cardsApi: { add } });
    go('menu-metodos');
    go('add-method');
    fixture.componentInstance['cardNumber'].set('123');
    fixture.componentInstance['cardCvc'].set('123');
    fixture.detectChanges();
    const btn = el.querySelector('[data-testid="save-card"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    btn.click();
    expect(add).not.toHaveBeenCalled();
  });

  it('métodos: número Visa/MC se formatea en grupos de 4 y detecta la marca', async () => {
    await setup();
    const comp = fixture.componentInstance;
    comp['onCardNumberInput']('4242424242424242');
    expect(comp['cardNumberDisplay']()).toBe('4242 4242 4242 4242');
    expect(comp['cardBrand']()).toBe('visa');
    comp['onCardNumberInput']('5555555555554444');
    expect(comp['cardBrand']()).toBe('mastercard');
  });

  it('métodos: número Amex se formatea 4-6-5 y detecta la marca', async () => {
    await setup();
    const comp = fixture.componentInstance;
    comp['onCardNumberInput']('378282246310005');
    expect(comp['cardBrand']()).toBe('amex');
    expect(comp['cardNumberDisplay']()).toBe('3782 822463 10005');
  });

  it('métodos: no acepta más dígitos que el máximo por marca', async () => {
    await setup();
    const comp = fixture.componentInstance;
    comp['onCardNumberInput']('4242424242424242999'); // Visa → 16
    expect(comp['cardNumber']().length).toBe(16);
    comp['onCardNumberInput']('378282246310005123'); // Amex → 15
    expect(comp['cardNumber']().length).toBe(15);
  });

  it('métodos: CVV admite 4 dígitos en Amex y 3 en Visa/MC (recorta el exceso)', async () => {
    await setup();
    const comp = fixture.componentInstance;
    comp['onCardNumberInput']('378282246310005'); // Amex
    expect(comp['cvcMaxLen']()).toBe(4);
    comp['onCardCvcInput']('12345');
    expect(comp['cardCvc']()).toBe('1234');
    comp['onCardNumberInput']('4242424242424242'); // Visa
    expect(comp['cvcMaxLen']()).toBe(3);
    comp['onCardCvcInput']('1234');
    expect(comp['cardCvc']()).toBe('123');
  });

  it('métodos: mes de expiración inválido (00/13) marca error; 01–12 es válido', async () => {
    await setup();
    const comp = fixture.componentInstance;
    comp['onCardExpMonthInput']('00');
    expect(comp['expMonthValid']()).toBe(false);
    comp['onCardExpMonthInput']('13');
    expect(comp['expMonthValid']()).toBe(false);
    comp['onCardExpMonthInput']('12');
    expect(comp['expMonthValid']()).toBe(true);
  });

  it('métodos: año de expiración menor al actual es inválido', async () => {
    await setup();
    const comp = fixture.componentInstance;
    const yy = new Date().getFullYear() % 100;
    comp['onCardExpYearInput'](String(yy - 1).padStart(2, '0'));
    expect(comp['expYearValid']()).toBe(false);
    comp['onCardExpYearInput'](String(yy).padStart(2, '0'));
    expect(comp['expYearValid']()).toBe(true);
  });

  it('métodos: marca no reconocida (no Visa/MC/Amex) se marca inválida', async () => {
    await setup();
    const comp = fixture.componentInstance;
    comp['onCardNumberInput']('9999999999999999');
    expect(comp['cardBrandRecognized']()).toBe(false);
    expect(comp['cardNumberValid']()).toBe(false);
  });

  it('métodos: eliminar tarjeta pide confirmación y luego llama al API', async () => {
    const remove = jasmine.createSpy('remove').and.returnValue(of({ deleted: true }));
    const list = () => of([{ id: 'c9', brand: 'visa', last4: '4242', isDefault: true, createdAt: '2026-07-01' }]);
    await setup({ cardsApi: { list, remove } });
    go('menu-metodos');
    go('remove-card');
    // No se elimina al primer click: aparece el modal de confirmación.
    expect(remove).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="confirm-dialog"]')).not.toBeNull();
    go('confirm-accept');
    expect(remove).toHaveBeenCalledWith('c9');
  });

  it('métodos: cancelar la confirmación NO elimina la tarjeta', async () => {
    const remove = jasmine.createSpy('remove').and.returnValue(of({ deleted: true }));
    const list = () => of([{ id: 'c9', brand: 'visa', last4: '4242', isDefault: true, createdAt: '2026-07-01' }]);
    await setup({ cardsApi: { list, remove } });
    go('menu-metodos');
    go('remove-card');
    go('confirm-cancel');
    expect(remove).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="confirm-dialog"]')).toBeNull();
  });

  it('facturación vacía muestra estado vacío bonito (empty-state)', async () => {
    await setup();
    go('menu-facturacion');
    const empty = el.querySelector('[data-testid="orders-empty"]');
    expect(empty).not.toBeNull();
    // Es el componente empty-state (ilustración + CTA), no una sola línea.
    expect(empty?.querySelector('.empty-illustration')).not.toBeNull();
    expect(empty?.querySelector('[data-testid="empty-cta"]')).not.toBeNull();
  });

  it('cancelar retiro llama al API y notifica', async () => {
    const cancelWithdrawal = jasmine.createSpy('c').and.returnValue(of({}));
    await setup({ wallet: { cancelWithdrawal } });
    fixture.componentInstance['cancelWithdrawal']('w1');
    expect(cancelWithdrawal).toHaveBeenCalledWith('w1');
    expect(lastToast()?.kind).toBe('info');
  });

  it('cancelar retiro con error muestra toast de error', async () => {
    const cancelWithdrawal = jasmine.createSpy('c').and.returnValue(throwError(() => new Error('x')));
    await setup({ wallet: { cancelWithdrawal } });
    fixture.componentInstance['cancelWithdrawal']('w1');
    expect(lastToast()?.kind).toBe('error');
  });

  it('cambiar contraseña sin completar campos → warning', async () => {
    await setup();
    fixture.componentInstance['changePassword']();
    expect(lastToast()?.kind).toBe('warning');
  });

  it('cambiar contraseña nueva demasiado corta → warning', async () => {
    await setup();
    fixture.componentInstance['currentPassword'].set('actual');
    fixture.componentInstance['newPassword'].set('short');
    fixture.componentInstance['confirmPassword'].set('short');
    go('change-password');
    expect(lastToast()?.kind).toBe('warning');
  });

  it('métodos: hacer predeterminada y errores muestran toasts', async () => {
    const setDefault = jasmine.createSpy('sd').and.returnValue(of({}));
    const list = () => of([
      { id: 'c1', brand: 'visa', last4: '4242', isDefault: true, createdAt: '2026-07-01' },
      { id: 'c2', brand: 'amex', last4: '0005', isDefault: false, createdAt: '2026-07-02' },
    ]);
    await setup({ cardsApi: { list, setDefault } });
    go('menu-metodos');
    go('set-default-card');
    expect(setDefault).toHaveBeenCalledWith('c2');
    expect(lastToast()?.kind).toBe('info');
  });

  it('métodos: error al guardar tarjeta muestra toast', async () => {
    const add = jasmine.createSpy('add').and.returnValue(throwError(() => new Error('x')));
    await setup({ cardsApi: { add } });
    go('menu-metodos');
    go('add-method');
    fixture.componentInstance['cardNumber'].set('4242424242424242');
    fixture.componentInstance['cardExpMonth'].set('12');
    fixture.componentInstance['cardExpYear'].set(String((new Date().getFullYear() % 100) + 2).padStart(2, '0'));
    fixture.componentInstance['cardCvc'].set('123');
    fixture.detectChanges(); // habilita el botón (cardFormValid) antes de hacer click
    go('save-card');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(lastToast()?.kind).toBe('error');
  });

  it('facturación: ocultar la cadena tras verla', async () => {
    const chain = { orderId: 'o1', chainValid: true, transactions: [] };
    const ledgerChain = jasmine.createSpy('lc').and.returnValue(of(chain));
    await setup({ orders: { movements: () => of({ items: MOVEMENTS }), ledgerChain } });
    go('menu-facturacion');
    fixture.componentInstance['loadChain']('o1'); // carga
    fixture.detectChanges();
    expect(fixture.componentInstance['chains']()['o1']).toBeDefined();
    fixture.componentInstance['loadChain']('o1'); // alterna → oculta
    expect(fixture.componentInstance['chains']()['o1']).toBeUndefined();
  });

  // Feed unificado de movimientos: un egreso (compra) y un ingreso (devolución).
  const MOVEMENTS = [
    { id: 'ledger:e1', direction: 'income', kind: 'refund', amount: '25.00', currency: 'GTQ', status: null, eventName: 'Concierto', orderId: 'o2', createdAt: '2026-07-05T10:00:00Z' },
    { id: 'order:o1', direction: 'expense', kind: 'purchase', amount: '129.68', currency: 'GTQ', status: 'paid', eventName: 'Fiesta', orderId: 'o1', createdAt: '2026-07-01T10:00:00Z' },
  ];

  it('facturación lista movimientos con evento, tipo y monto', async () => {
    await setup({ orders: { movements: () => of({ items: MOVEMENTS }) } });
    go('menu-facturacion');
    const list = el.querySelector('[data-testid="orders-list"]');
    expect(list?.textContent).toContain('Fiesta');
    expect(list?.textContent).toContain('129.68');
    expect(list?.textContent).toContain('Devolución'); // kind refund traducido
    expect(list?.textContent).toContain('25.00'); // el ingreso
  });

  // W7: liquidación del promotor (movimiento event_settlement).
  const SETTLEMENT = [
    { id: 'settle:e9', direction: 'income', kind: 'event_settlement', amount: '5000.00', currency: 'GTQ', status: 'paid', eventName: 'Gran Concierto', eventId: 'e9', orderId: null, createdAt: '2026-07-10T10:00:00Z' },
  ];

  it('W7: liquidación se muestra como badge + título distinto y con los 2 botones', async () => {
    await setup({ roles: ['promoter'], orders: { movements: () => of({ items: SETTLEMENT }) } });
    go('menu-facturacion');
    const list = el.querySelector('[data-testid="orders-list"]');
    expect(el.querySelector('[data-testid="settlement-badge"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="settlement-title"]')?.textContent).toContain('Gran Concierto');
    expect(el.querySelector('[data-testid="settlement-download"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="settlement-view-accounts"]')).not.toBeNull();
    // No debe ofrecer los botones de compra normal (no hay orderId).
    expect(list?.querySelector('[data-testid="ver-detalle"]')).toBeNull();
  });

  it('W7: "Descargar detalle" pide el .xlsx por evento (blob)', async () => {
    const exportSettlement = jasmine.createSpy('export').and.returnValue(
      of(new HttpResponse<Blob>({ body: new Blob(['x']), headers: new HttpHeaders() })),
    );
    // Evita la manipulación real del DOM/URL en el navegador de prueba.
    spyOn(URL, 'createObjectURL').and.returnValue('blob:fake');
    spyOn(URL, 'revokeObjectURL');
    await setup({
      roles: ['promoter'],
      orders: { movements: () => of({ items: SETTLEMENT }) },
      promoterEvents: { exportSettlement },
    });
    go('menu-facturacion');
    go('settlement-download');
    await fixture.whenStable();
    expect(exportSettlement).toHaveBeenCalledWith('e9');
  });

  it('W7: "Descargar detalle" con error muestra toast', async () => {
    const exportSettlement = jasmine.createSpy('export').and.returnValue(throwError(() => new Error('x')));
    await setup({
      roles: ['promoter'],
      orders: { movements: () => of({ items: SETTLEMENT }) },
      promoterEvents: { exportSettlement },
    });
    go('menu-facturacion');
    go('settlement-download');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(lastToast()?.kind).toBe('error');
  });

  it('W7: "Ver detalle de cuentas" navega a la tab cuentas del evento', async () => {
    await setup({ roles: ['promoter'], orders: { movements: () => of({ items: SETTLEMENT }) } });
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    go('menu-facturacion');
    go('settlement-view-accounts');
    expect(nav).toHaveBeenCalledWith(['/promotor/eventos', 'e9', 'editar'], { queryParams: { tab: 'cuentas' } });
  });

  it('B5: el historial del promotor lista las liquidaciones recibidas (event_settlement)', async () => {
    await setup({ roles: ['promoter'], orders: { movements: () => of({ items: SETTLEMENT }) } });
    go('menu-facturacion');
    const list = el.querySelector('[data-testid="orders-list"]');
    expect(list).not.toBeNull();
    // Título "Liquidación — <evento>", badge de liquidación y monto neto liquidado.
    const title = el.querySelector('[data-testid="settlement-title"]')?.textContent ?? '';
    expect(title).toContain('Liquidación');
    expect(title).toContain('Gran Concierto');
    expect(el.querySelector('[data-testid="settlement-badge"]')).not.toBeNull();
    expect(list?.textContent).toContain('5,000.00');
    // Incluye el nuevo botón "Ver transacción" (B4).
    expect(el.querySelector('[data-testid="settlement-view-transaction"]')).not.toBeNull();
  });

  it('B4: liquidación muestra "Descargar detalle", "Ver transacción" y "Ver cuentas" con toggle de cadena disponible', async () => {
    await setup({ roles: ['promoter'], orders: { movements: () => of({ items: SETTLEMENT }) } });
    go('menu-facturacion');
    expect(el.querySelector('[data-testid="settlement-download"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="settlement-view-transaction"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="settlement-view-accounts"]')).not.toBeNull();
    // La validación de la cadena está SIEMPRE disponible, también en liquidaciones.
    expect(el.querySelector('[data-testid="toggle-chain"]')).not.toBeNull();
  });

  it('B4: "Ver transacción" de una liquidación abre el detalle inline de la transacción', async () => {
    await setup({ roles: ['promoter'], orders: { movements: () => of({ items: SETTLEMENT }) } });
    go('menu-facturacion');
    expect(el.querySelector('[data-testid="settlement-detail"]')).toBeNull();
    go('settlement-view-transaction');
    const detail = el.querySelector('[data-testid="settlement-detail"]');
    expect(detail).not.toBeNull();
    expect(detail?.textContent).toContain('Gran Concierto');
    expect(detail?.textContent).toContain('5,000.00');
    // Alterna: un segundo click lo oculta.
    go('settlement-view-transaction');
    expect(el.querySelector('[data-testid="settlement-detail"]')).toBeNull();
  });

  it('B4: el toggle de cadena de una liquidación carga y muestra la validación (usa el eventId disponible)', async () => {
    const chain = {
      orderId: 'x',
      chainValid: true,
      transactions: [{ seq: '1', kind: 'event_cash_transfer', createdAt: '2026-07-10', hash: 'abcdef0123456789', prevHash: '', verified: true }],
    };
    const eventLedgerChain = jasmine.createSpy('elc').and.returnValue(of(chain));
    await setup({ roles: ['promoter'], orders: { movements: () => of({ items: SETTLEMENT }), eventLedgerChain } });
    go('menu-facturacion');
    go('toggle-chain');
    await fixture.whenStable();
    fixture.detectChanges();
    // La liquidación no tiene orderId → consulta la cadena por EVENTO (endpoint event-scoped).
    expect(eventLedgerChain).toHaveBeenCalledWith('e9');
    expect(el.querySelector('[data-testid="ledger-chain"]')?.textContent).toContain('íntegra');
  });

  it('B3: el selector de idioma del perfil muestra banderas (SVG) y guarda el idioma elegido', async () => {
    const updateMe = jasmine.createSpy('updateMe').and.returnValue(of({ firstName: 'Ana', language: 'en' }));
    await setup({ users: { updateMe } });
    // Perfil es la sección por defecto: ambas opciones renderizan su bandera SVG.
    const es = el.querySelector('[data-testid="account-lang-es"]');
    const en = el.querySelector('[data-testid="account-lang-en"]');
    expect(es?.querySelector('svg.flag')).not.toBeNull();
    expect(en?.querySelector('svg.flag')).not.toBeNull();
    // Guardar persiste el idioma elegido en BD (PATCH /users/me).
    const c = fixture.componentInstance as unknown as { setProfileLang: (l: string) => void };
    c.setProfileLang('en');
    fixture.detectChanges();
    (el.querySelector('[data-testid="save-language"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(updateMe).toHaveBeenCalledWith({ language: 'en' });
  });

  it('facturación filtra por dirección (ingresos vs egresos)', async () => {
    await setup({ orders: { movements: () => of({ items: MOVEMENTS }) } });
    go('menu-facturacion');
    go('dir-income');
    let list = el.querySelector('[data-testid="orders-list"]');
    expect(list?.textContent).toContain('Concierto'); // ingreso (refund)
    expect(list?.textContent).not.toContain('Fiesta'); // egreso oculto
    go('dir-expense');
    list = el.querySelector('[data-testid="orders-list"]');
    expect(list?.textContent).toContain('Fiesta');
    expect(list?.textContent).not.toContain('Concierto');
  });

  it('P4: cliente SIN ingresos NO ve el filtro "Ingresos"', async () => {
    const ONLY_EXPENSE = [
      { id: 'order:o1', direction: 'expense', kind: 'purchase', amount: '129.68', currency: 'GTQ', status: 'paid', eventName: 'Fiesta', orderId: 'o1', createdAt: '2026-07-01T10:00:00Z' },
    ];
    await setup({ roles: ['buyer'], orders: { movements: () => of({ items: ONLY_EXPENSE }) } });
    go('menu-facturacion');
    expect(el.querySelector('[data-testid="dir-income"]')).toBeNull();
    expect(el.querySelector('[data-testid="dir-expense"]')).not.toBeNull();
  });

  it('P4: cliente CON un ingreso (devolución) SÍ ve el filtro "Ingresos"', async () => {
    await setup({ roles: ['buyer'], orders: { movements: () => of({ items: MOVEMENTS }) } });
    go('menu-facturacion');
    expect(el.querySelector('[data-testid="dir-income"]')).not.toBeNull();
  });

  it('P4: el promotor SIEMPRE ve el filtro "Ingresos" (aunque solo tenga egresos)', async () => {
    const ONLY_EXPENSE = [
      { id: 'order:o1', direction: 'expense', kind: 'purchase', amount: '129.68', currency: 'GTQ', status: 'paid', eventName: 'Fiesta', orderId: 'o1', createdAt: '2026-07-01T10:00:00Z' },
    ];
    await setup({ roles: ['promoter'], orders: { movements: () => of({ items: ONLY_EXPENSE }) } });
    go('menu-facturacion');
    expect(el.querySelector('[data-testid="dir-income"]')).not.toBeNull();
  });

  it('facturación: filtro sin coincidencias muestra vacío bonito', async () => {
    await setup({ orders: { movements: () => of({ items: MOVEMENTS }) } });
    go('menu-facturacion');
    fixture.componentInstance['filterEvent'].set('inexistente');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="orders-filtered-empty"]')).not.toBeNull();
  });

  it('deep-link con ?order filtra una sola compra y permite limpiar', async () => {
    await setup({ section: 'facturacion', orders: { movements: () => of({ items: MOVEMENTS }) } });
    // Forzamos el filtro por orden (deep-link) manualmente.
    fixture.componentInstance['orderFilter'].set('o2');
    fixture.detectChanges();
    const list = el.querySelector('[data-testid="orders-list"]');
    expect(list?.textContent).toContain('Concierto');
    expect(list?.textContent).not.toContain('Fiesta');
    go('clear-order-filter');
    expect(fixture.componentInstance['orderFilter']()).toBeNull();
  });

  it('facturación muestra la cadena blockchain al pedirla (movimiento con orden)', async () => {
    const chain = { orderId: 'o1', chainValid: true, transactions: [{ seq: '1', kind: 'order_payment', createdAt: '2026-07-01', hash: 'abcdef0123456789', prevHash: '', verified: true }] };
    const ledgerChain = jasmine.createSpy('lc').and.returnValue(of(chain));
    await setup({ orders: { movements: () => of({ items: MOVEMENTS }), ledgerChain } });
    go('menu-facturacion');
    // El primer movimiento (más reciente) es el ingreso o1... buscamos toggle sobre o1.
    const toggles = el.querySelectorAll('[data-testid="toggle-chain"]');
    (toggles[toggles.length - 1] as HTMLButtonElement).click(); // el egreso (compra o1)
    await fixture.whenStable();
    fixture.detectChanges();
    expect(ledgerChain).toHaveBeenCalledWith('o1');
    const chainEl = el.querySelector('[data-testid="ledger-chain"]');
    expect(chainEl?.textContent).toContain('íntegra');
    expect(chainEl?.textContent).toContain('order_payment');
  });

  it('facturación: error al cargar la cadena muestra toast', async () => {
    const ledgerChain = jasmine.createSpy('lc').and.returnValue(throwError(() => new Error('x')));
    await setup({ orders: { movements: () => of({ items: MOVEMENTS }), ledgerChain } });
    go('menu-facturacion');
    (el.querySelector('[data-testid="toggle-chain"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(lastToast()?.kind).toBe('error');
  });

  it('facturación: pagina (6 por página) y navega entre páginas', async () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      id: `order:o${i}`,
      direction: 'expense',
      kind: 'purchase',
      amount: '10.00',
      currency: 'GTQ',
      status: 'paid',
      eventName: 'Fiesta',
      orderId: `o${i}`,
      createdAt: '2026-07-01T10:00:00Z',
    }));
    await setup({ orders: { movements: () => of({ items: many }) } });
    go('menu-facturacion');
    const c = fixture.componentInstance as unknown as {
      pageMovements: () => unknown[];
      billingTotalPages: () => number;
      goToBillingPage: (p: number) => void;
      billingPage: () => number;
    };
    expect(c.pageMovements().length).toBe(6);
    expect(c.billingTotalPages()).toBe(3);
    expect(el.querySelector('[data-testid="billing-pager"]')).not.toBeNull();
    c.goToBillingPage(3);
    expect(c.billingPage()).toBe(3);
    expect(c.pageMovements().length).toBe(2);
  });

  it('facturación: cambiar filtro reinicia a la página 1', async () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      id: `order:o${i}`, direction: 'expense', kind: 'purchase', amount: '10.00', currency: 'GTQ', status: 'paid', eventName: 'Fiesta', orderId: `o${i}`, createdAt: '2026-07-01T10:00:00Z',
    }));
    await setup({ orders: { movements: () => of({ items: many }) } });
    go('menu-facturacion');
    const c = fixture.componentInstance as unknown as {
      goToBillingPage: (p: number) => void;
      setFilterEvent: (v: string) => void;
      billingPage: () => number;
    };
    c.goToBillingPage(2);
    expect(c.billingPage()).toBe(2);
    c.setFilterEvent('Fiesta');
    expect(c.billingPage()).toBe(1);
  });

  it('boletos activos: pagina los grupos de evento (6 por página)', async () => {
    const items = Array.from({ length: 14 }, (_, i) => ({
      id: `t${i}`, serial: `PE-${i}`, status: 'valid', eventId: `e${i}`, orderId: `o${i}`, localityName: 'GA', mediaReady: false, event: { name: `Ev ${i}` },
    }));
    await setup({ tickets: { list: () => of({ items } as unknown as TicketPageResponseDto), media: () => of({}), transfer: () => of({}) } });
    go('menu-activos');
    const c = fixture.componentInstance as unknown as {
      pageActivosGrouped: () => unknown[];
      activosTotalPages: () => number;
      goToActivosPage: (p: number) => void;
      activosPage: () => number;
    };
    expect(c.pageActivosGrouped().length).toBe(6);
    expect(c.activosTotalPages()).toBe(3);
    expect(el.querySelector('[data-testid="activos-pager"]')).not.toBeNull();
    c.goToActivosPage(3);
    expect(c.activosPage()).toBe(3);
    expect(c.pageActivosGrouped().length).toBe(2);
  });

  it('boletos activos: pagina las compras dentro de un evento (nivel 2, 3 por página)', async () => {
    // Un solo evento con 7 compras (una por orden) → nivel 2 pagina de 3 en 3.
    const items = Array.from({ length: 7 }, (_, i) => ({
      id: `t${i}`, serial: `PE-${i}`, status: 'valid', eventId: 'e1', orderId: `o${i}`, localityName: 'GA', mediaReady: false, event: { name: 'Fiesta' },
    }));
    await setup({ tickets: { list: () => of({ items } as unknown as TicketPageResponseDto), media: () => of({}), transfer: () => of({}) } });
    go('menu-activos');
    const c = fixture.componentInstance as unknown as {
      activosGrouped: () => { eventId: string; orders: unknown[] }[];
      orderTotalPages: (eg: unknown) => number;
      pageOrdersOf: (k: string, eg: unknown) => unknown[];
      orderPageOf: (k: string, id: string) => number;
      goToOrderPage: (k: string, id: string, p: number) => void;
    };
    const eg = c.activosGrouped()[0];
    expect(eg.orders.length).toBe(7);
    expect(c.orderTotalPages(eg)).toBe(3); // ceil(7/3)
    expect(c.pageOrdersOf('activos', eg).length).toBe(3);
    c.goToOrderPage('activos', 'e1', 3);
    expect(c.orderPageOf('activos', 'e1')).toBe(3);
    expect(c.pageOrdersOf('activos', eg).length).toBe(1); // última página: resto
  });

  it('boletos activos vacío muestra empty-state con CTA a explorar eventos', async () => {
    await setup({ tickets: { list: () => of({ items: [] } as unknown as TicketPageResponseDto), media: () => of({}), transfer: () => of({}) } });
    go('menu-activos');
    const empty = el.querySelector('[data-testid="activos-empty"]');
    expect(empty).not.toBeNull();
    expect(empty?.querySelector('[data-testid="empty-cta"]')).not.toBeNull();
  });

  it('boletos pasados: pagina los grupos de evento (nivel 1) y muestra empty-state si no hay', async () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      id: `t${i}`, serial: `PE-${i}`, status: 'used', eventId: `e${i}`, orderId: `o${i}`, localityName: 'GA', event: { name: `Ev ${i}` },
    }));
    await setup({ tickets: { list: () => of({ items } as unknown as TicketPageResponseDto), media: () => of({}), transfer: () => of({}) } });
    go('menu-pasados');
    const c = fixture.componentInstance as unknown as {
      eventTotalPages: (k: string) => number;
      pageEvents: (k: string) => unknown[];
    };
    expect(c.eventTotalPages('pasados')).toBe(2); // ceil(8/6)
    expect(c.pageEvents('pasados').length).toBe(6);
    expect(el.querySelector('[data-testid="pasados-pager"]')).not.toBeNull();
  });

  it('facturación filtra por ESTADO de la transacción (v3.7)', async () => {
    const data = [
      { id: 'ledger:e1', direction: 'income', kind: 'refund', amount: '25.00', currency: 'GTQ', status: 'refunded', eventName: 'Concierto', orderId: 'o2', createdAt: '2026-07-05T10:00:00Z' },
      { id: 'order:o1', direction: 'expense', kind: 'purchase', amount: '129.68', currency: 'GTQ', status: 'paid', eventName: 'Fiesta', orderId: 'o1', createdAt: '2026-07-01T10:00:00Z' },
      { id: 'order:o3', direction: 'expense', kind: 'purchase', amount: '50.00', currency: 'GTQ', status: 'pending', eventName: 'Feria', orderId: 'o3', createdAt: '2026-06-01T10:00:00Z' },
    ];
    await setup({ orders: { movements: () => of({ items: data }) } });
    go('menu-facturacion');
    // El filtro por estado existe y ofrece los estados presentes.
    expect(el.querySelector('[data-testid="filter-status"]')).not.toBeNull();
    const c = fixture.componentInstance as unknown as {
      movementStatuses: () => string[];
      setMovementStatus: (v: string) => void;
    };
    expect(c.movementStatuses()).toEqual(['paid', 'pending', 'refunded']);
    // Filtra a 'refunded' → solo el ingreso devuelto.
    c.setMovementStatus('refunded');
    fixture.detectChanges();
    let list = el.querySelector('[data-testid="orders-list"]');
    expect(list?.textContent).toContain('Concierto');
    expect(list?.textContent).not.toContain('Fiesta');
    expect(list?.textContent).not.toContain('Feria');
    // Filtra a 'pending' → solo esa compra.
    c.setMovementStatus('pending');
    fixture.detectChanges();
    list = el.querySelector('[data-testid="orders-list"]');
    expect(list?.textContent).toContain('Feria');
    expect(list?.textContent).not.toContain('Fiesta');
  });

  it('perfil: el botón Guardar idioma aparece al cambiar y desaparece al volver al actual', async () => {
    await setup();
    // Perfil es la sección por defecto; idioma activo = es → sin botón Guardar.
    expect(el.querySelector('[data-testid="save-language"]')).toBeNull();
    const c = fixture.componentInstance as unknown as { setProfileLang: (l: string) => void };
    c.setProfileLang('en');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="save-language"]')).not.toBeNull();
    // Volver al idioma actual → el botón desaparece.
    c.setProfileLang('es');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="save-language"]')).toBeNull();
  });

  it('perfil: guardar idioma llama al API, refresca la sesión y aplica el idioma', async () => {
    const updateMe = jasmine.createSpy('updateMe').and.returnValue(
      of({ firstName: 'Ana', language: 'en' }),
    );
    await setup({ users: { updateMe } });
    const c = fixture.componentInstance as unknown as { setProfileLang: (l: string) => void };
    c.setProfileLang('en');
    fixture.detectChanges();
    (el.querySelector('[data-testid="save-language"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(updateMe).toHaveBeenCalledWith({ language: 'en' });
    expect(setUser).toHaveBeenCalled();
    expect(TestBed.inject(I18nService).lang()).toBe('en');
    expect(lastToast()?.kind).toBe('success');
  });

  it('traduce los textos al cambiar el idioma a inglés', async () => {
    await setup();
    // Español por defecto.
    expect(el.querySelector('h1')?.textContent).toContain('Mi cuenta');
    TestBed.inject(I18nService).use('en');
    fixture.detectChanges();
    expect(el.querySelector('h1')?.textContent).toContain('My account');
    expect(el.querySelector('[data-testid="menu-wallet"]')?.textContent).toContain('Wallet');
    expect(el.querySelector('[data-testid="menu-metodos"]')?.textContent).toContain('Payment methods');
  });
});
