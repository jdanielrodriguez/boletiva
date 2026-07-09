import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { OrdersApi } from '../../core/api/orders.api';
import { TicketsApi } from '../../core/api/tickets.api';
import { TransfersApi } from '../../core/api/transfers.api';
import { UsersApi } from '../../core/api/users.api';
import { WalletApi } from '../../core/api/wallet.api';
import type { TicketPageResponseDto, WalletBalanceResponseDto } from '../../core/api/types';
import { SessionStore } from '../../core/auth/session.store';
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
}

describe('Account (mi cuenta)', () => {
  let fixture: ComponentFixture<Account>;
  let el: HTMLElement;
  let setUser: jasmine.Spy;

  async function setup(o: Overrides = {}) {
    setUser = jasmine.createSpy('setUser');
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
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
        {
          provide: SessionStore,
          useValue: {
            user: () => ({ firstName: 'Ana', lastName: 'P', email: 'ana@correo.com' }),
            setUser,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(Account);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const go = (testid: string) => {
    (el.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement).click();
    fixture.detectChanges();
  };

  it('perfil muestra el correo del usuario', async () => {
    await setup();
    expect(el.textContent).toContain('ana@correo.com');
  });

  it('guardar perfil llama updateMe y refresca la sesión', async () => {
    const updateMe = jasmine.createSpy('updateMe').and.returnValue(of({ firstName: 'Nuevo' }));
    await setup({ users: { updateMe } });
    go('save-profile');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(updateMe).toHaveBeenCalled();
    expect(setUser).toHaveBeenCalled();
    expect(el.querySelector('[data-testid="profile-saved"]')).not.toBeNull();
  });

  it('wallet muestra el saldo', async () => {
    await setup();
    go('menu-wallet');
    expect(el.querySelector('[data-testid="wallet-balance"]')?.textContent).toContain('50.00');
  });

  it('wallet explicita el origen del saldo (reembolsos/reventas, no recarga con tarjeta)', async () => {
    await setup();
    go('menu-wallet');
    const note = el.querySelector('[data-testid="wallet-source"]')?.textContent ?? '';
    expect(note).toContain('reembolsos');
    expect(note).toContain('reventas');
    expect(note.toLowerCase()).toContain('tarjeta');
  });

  it('solicitar retiro sin monto muestra error', async () => {
    await setup();
    go('menu-wallet');
    go('request-withdrawal');
    expect(el.querySelector('[data-testid="withdraw-error"]')).not.toBeNull();
  });

  it('solicitar retiro con monto llama al API', async () => {
    const requestWithdrawal = jasmine.createSpy('req').and.returnValue(of({}));
    await setup({ wallet: { requestWithdrawal } });
    go('menu-wallet');
    fixture.componentInstance['withdrawAmount'].set(100);
    go('request-withdrawal');
    expect(requestWithdrawal).toHaveBeenCalledWith({ amount: 100 });
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

  it('media no lista muestra error amistoso', async () => {
    const media = jasmine.createSpy('media').and.returnValue(throwError(() => new Error('nope')));
    await setup({ tickets: { list: () => of(TICKETS), media, transfer: () => of({}) } });
    go('menu-activos');
    go('ticket-media');
    expect(el.querySelector('[data-testid="ticket-error"]')).not.toBeNull();
  });

  it('facturación vacía muestra estado vacío', async () => {
    await setup();
    go('menu-facturacion');
    expect(el.querySelector('[data-testid="orders-empty"]')).not.toBeNull();
  });

  it('agregar método muestra la nota', async () => {
    await setup();
    go('menu-metodos');
    go('add-method');
    expect(el.querySelector('[data-testid="add-method-note"]')).not.toBeNull();
  });
});
