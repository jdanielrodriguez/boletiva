import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { TicketsApi } from '../../core/api/tickets.api';
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

describe('Account (mi cuenta)', () => {
  let fixture: ComponentFixture<Account>;
  let el: HTMLElement;

  async function setup() {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: WalletApi, useValue: { balance: () => of({ balance: '50.00', currency: 'GTQ' } as WalletBalanceResponseDto) } },
        { provide: TicketsApi, useValue: { list: () => of(TICKETS) } },
        {
          provide: SessionStore,
          useValue: { user: () => ({ firstName: 'Ana', lastName: 'P', email: 'ana@correo.com' }) },
        },
      ],
    });
    fixture = TestBed.createComponent(Account);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  it('perfil muestra el correo del usuario', async () => {
    await setup();
    expect(el.textContent).toContain('ana@correo.com');
  });

  it('wallet muestra el saldo', async () => {
    await setup();
    (el.querySelector('[data-testid="menu-wallet"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="wallet-balance"]')?.textContent).toContain('50.00');
  });

  it('boletos activos lista solo los válidos (no usados)', async () => {
    await setup();
    (el.querySelector('[data-testid="menu-activos"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const list = el.querySelector('[data-testid="tickets-activos"]');
    expect(list?.textContent).toContain('Fiesta');
    expect(list?.textContent).not.toContain('Concierto'); // usado → va a pasados
  });

  it('agregar método muestra la nota', async () => {
    await setup();
    (el.querySelector('[data-testid="menu-metodos"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelector('[data-testid="add-method"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="add-method-note"]')).not.toBeNull();
  });
});
