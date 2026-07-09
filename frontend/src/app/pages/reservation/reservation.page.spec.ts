import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ReservationsApi } from '../../core/api/reservations.api';
import { AuthService } from '../../core/auth/auth.service';
import { SessionStore } from '../../core/auth/session.store';
import type { ReservationResponseDto } from '../../core/api/types';
import { ReservationPage } from './reservation.page';

const RES = {
  token: 'tok-1',
  valid: true,
  expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
  eventName: 'Fiesta',
  eventSlug: 'fiesta',
  eventId: 'ev1',
  startsAt: '2028-01-01T00:00:00.000Z',
  currency: 'GTQ',
  total: '129.68',
  items: [{ seatId: 's1', label: 'GA-1', localityId: 'ga', localityName: 'General', price: { currency: 'GTQ', net: '100.00', serviceFee: '16.48', iva: '13.20', total: '129.68' } }],
};

describe('ReservationPage', () => {
  let fixture: ComponentFixture<ReservationPage>;
  let el: HTMLElement;

  async function setup(getByToken: () => ReturnType<ReservationsApi['getByToken']>) {
    const api = jasmine.createSpyObj<ReservationsApi>('ReservationsApi', ['getByToken', 'checkout', 'create']);
    api.getByToken.and.callFake(getByToken);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ReservationsApi, useValue: api },
        { provide: SessionStore, useValue: { ensureLoaded: () => of(null), isEmailVerified: () => false } },
        { provide: AuthService, useValue: {} },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ token: 'tok-1' })) } },
      ],
    });
    fixture = TestBed.createComponent(ReservationPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  afterEach(() => fixture?.destroy());

  it('muestra la reserva (ítems + total) desde el token', async () => {
    await setup(() => of(RES as unknown as ReservationResponseDto));
    expect(el.querySelector('.reservation-items li')?.textContent).toContain('General');
    expect(el.textContent).toContain('129.68');
    expect(el.querySelector('[data-testid="pay-btn"]')).not.toBeNull();
  });

  it('token inválido → muestra reserva no disponible', async () => {
    await setup(() => throwError(() => new Error('400')));
    expect(el.querySelector('[data-testid="reservation-invalid"]')).not.toBeNull();
  });

  it('continuar al pago sin sesión abre el modal de login', async () => {
    await setup(() => of(RES as unknown as ReservationResponseDto));
    (el.querySelector('[data-testid="pay-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="login-modal"]')).not.toBeNull();
  });
});
