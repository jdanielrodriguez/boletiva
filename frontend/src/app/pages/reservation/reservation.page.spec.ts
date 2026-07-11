import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideI18nTesting } from '../../core/i18n/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
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

  let api: jasmine.SpyObj<ReservationsApi>;

  interface SetupOpts {
    user?: unknown;
    verified?: boolean;
    checkout?: () => ReturnType<ReservationsApi['checkout']>;
  }

  async function setup(
    getByToken: () => ReturnType<ReservationsApi['getByToken']>,
    opts: SetupOpts = {},
  ) {
    api = jasmine.createSpyObj<ReservationsApi>('ReservationsApi', ['getByToken', 'checkout', 'create']);
    api.getByToken.and.callFake(getByToken);
    api.checkout.and.callFake(
      opts.checkout ?? ((() => of({ id: 'ord-1' })) as unknown as ReservationsApi['checkout']),
    );
    TestBed.configureTestingModule({
      providers: [
        ...provideI18nTesting(),
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ReservationsApi, useValue: api },
        {
          provide: SessionStore,
          useValue: {
            ensureLoaded: () => of(opts.user ?? null),
            isEmailVerified: () => opts.verified ?? false,
          },
        },
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
    expect(el.querySelector('[data-testid="reservation-items"]')?.textContent).toContain('General');
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

  it('usuario con correo verificado paga y navega al checkout de la orden', async () => {
    await setup(() => of(RES as unknown as ReservationResponseDto), {
      user: { id: 'u1' },
      verified: true,
    });
    const router = TestBed.inject(Router);
    const nav = spyOn(router, 'navigate').and.resolveTo(true);
    (el.querySelector('[data-testid="pay-btn"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(api.checkout).toHaveBeenCalledWith('tok-1');
    expect(nav).toHaveBeenCalledWith(['/checkout', 'ord-1']);
    // No abre login para un usuario ya verificado.
    expect(el.querySelector('[data-testid="login-modal"]')).toBeNull();
  });

  it('un fallo en el checkout muestra el mensaje de error y no navega', async () => {
    await setup(() => of(RES as unknown as ReservationResponseDto), {
      user: { id: 'u1' },
      verified: true,
      checkout: () => throwError(() => new Error('409')),
    });
    const router = TestBed.inject(Router);
    const nav = spyOn(router, 'navigate');
    (el.querySelector('[data-testid="pay-btn"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(nav).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="reservation-error"]')?.textContent?.length).toBeGreaterThan(0);
  });

  it('usuario logueado desde el modal (onLoggedIn) dispara el checkout', async () => {
    await setup(() => of(RES as unknown as ReservationResponseDto), {
      user: null, // primer intento sin sesión → abre modal
      verified: false,
    });
    spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    (el.querySelector('[data-testid="pay-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const modal = el.querySelector('[data-testid="login-modal"]');
    expect(modal).not.toBeNull();
    // Simula el evento de login exitoso del modal.
    (fixture.componentInstance as unknown as { onLoggedIn(): void }).onLoggedIn();
    await fixture.whenStable();
    expect(api.checkout).toHaveBeenCalledWith('tok-1');
  });

  it('el contador refleja el tiempo restante (mm:ss) de la reserva', async () => {
    const soon = new Date(Date.now() + 125_000).toISOString(); // ~2m05s
    await setup(() => of({ ...RES, expiresAt: soon } as unknown as ReservationResponseDto));
    const inst = fixture.componentInstance as unknown as {
      secondsLeft: { set(v: number): void };
      mm(): number;
      ss(): number;
    };
    inst.secondsLeft.set(125);
    expect(inst.mm()).toBe(2);
    expect(inst.ss()).toBe(5);
  });
});
