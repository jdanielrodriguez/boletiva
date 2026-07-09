import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
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
    { id: 't1', serial: 'PE-1', status: 'valid', eventId: 'e1', event: { name: 'Fiesta' } },
    { id: 't2', serial: 'PE-2', status: 'used', eventId: 'e1', event: { name: 'Concierto' } },
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
        { provide: OrdersApi, useValue: { list: () => of({ items: [], nextCursor: null }), ...o.orders } as unknown as OrdersApi },
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

  it('transferir un boleto muestra el código a compartir', async () => {
    const transfer = jasmine.createSpy('transfer').and.returnValue(of({ code: 'K7MNPQ23' }));
    await setup({ tickets: { list: () => of(TICKETS), media: () => of({}), transfer } });
    go('menu-activos');
    go('ticket-transfer');
    expect(transfer).toHaveBeenCalledWith('t1');
    expect(el.querySelector('[data-testid="transfer-code"]')?.textContent).toContain('K7MNPQ23');
  });

  it('ver media carga QR/PDF del boleto', async () => {
    const media = jasmine.createSpy('media').and.returnValue(of({ qrUrl: 'http://x/qr.png', pdfUrl: 'http://x/p.pdf' }));
    await setup({ tickets: { list: () => of(TICKETS), media, transfer: () => of({}) } });
    go('menu-activos');
    go('ticket-media');
    expect(media).toHaveBeenCalledWith('t1');
    expect(el.querySelector('.ticket-media img')?.getAttribute('src')).toContain('qr.png');
  });

  it('media no lista muestra toast warning', async () => {
    const media = jasmine.createSpy('media').and.returnValue(throwError(() => new Error('nope')));
    await setup({ tickets: { list: () => of(TICKETS), media, transfer: () => of({}) } });
    go('menu-activos');
    go('ticket-media');
    expect(lastToast()?.kind).toBe('warning');
  });

  it('facturación vacía muestra estado vacío', async () => {
    await setup();
    go('menu-facturacion');
    expect(el.querySelector('[data-testid="orders-empty"]')).not.toBeNull();
  });
});
