import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { EventsApi } from '../../core/api/events.api';
import { ReservationsApi } from '../../core/api/reservations.api';
import { BillingApi } from '../../core/api/billing.api';
import { AuthService } from '../../core/auth/auth.service';
import { SessionStore } from '../../core/auth/session.store';
import { SITE_URL } from '../../core/config/api.tokens';
import { I18nService } from '../../core/i18n/i18n.service';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
import type { EventAvailabilityDto, PublicEventDetailDto, ReservationResponseDto } from '../../core/api/types';
import { PurchasePage } from './purchase.page';

const EVENT = { id: 'ev1', name: 'Fiesta', slug: 'fiesta', media: [], localities: [] };
const AVAIL = {
  seatMap: null,
  localities: [
    { id: 'ga', name: 'General', slug: 'general', kind: 'general', capacity: 100, available: 80, price: { currency: 'GTQ', net: '75.00', serviceFee: '12.36', iva: '9.90', total: '97.26' } },
  ],
  seats: [],
};
const RESERVATION = {
  token: 'tok-abc',
  valid: true,
  expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
  items: [{ seatId: 'g1', label: 'GA-1', localityId: 'ga', localityName: 'General', price: { currency: 'GTQ', net: '75.00', serviceFee: '12.36', iva: '9.90', total: '97.26' } }],
  total: '194.52',
  eventId: 'ev1',
  eventName: 'Fiesta',
  eventSlug: 'fiesta',
  startsAt: '2028-01-01T00:00:00.000Z',
  currency: 'GTQ',
};

describe('PurchasePage', () => {
  let fixture: ComponentFixture<PurchasePage>;
  let el: HTMLElement;
  let reservations: jasmine.SpyObj<ReservationsApi>;

  async function setup() {
    const events = jasmine.createSpyObj<EventsApi>('EventsApi', ['getBySlug', 'availability']);
    events.getBySlug.and.returnValue(of(EVENT as unknown as PublicEventDetailDto));
    events.availability.and.returnValue(of(AVAIL as unknown as EventAvailabilityDto));
    reservations = jasmine.createSpyObj<ReservationsApi>('ReservationsApi', ['create', 'getByToken', 'checkout', 'cancel']);
    reservations.create.and.returnValue(of(RESERVATION as unknown as ReservationResponseDto));
    reservations.cancel.and.returnValue(of({ cancelled: true }));

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        ...provideI18nTesting(),
        { provide: EventsApi, useValue: events },
        { provide: ReservationsApi, useValue: reservations },
        { provide: BillingApi, useValue: { nitName: () => of({ available: false, name: null }) } },
        { provide: SITE_URL, useValue: 'http://localhost:4200' },
        { provide: SessionStore, useValue: { ensureLoaded: () => of(null), isEmailVerified: () => false, user: () => null } },
        { provide: AuthService, useValue: {} },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ slug: 'fiesta' })),
            snapshot: { queryParamMap: convertToParamMap({}) },
          },
        },
      ],
    });
    initI18nTesting();
    fixture = TestBed.createComponent(PurchasePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  afterEach(() => fixture?.destroy());

  it('muestra el cuadro de total y el botón Reservar arriba', async () => {
    await setup();
    expect(el.querySelector('.cart-top [data-testid="reserve-btn"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="loc-quantity"]')).not.toBeNull();
  });

  it('reservar SIN login crea reserva anónima y muestra compartir + countdown', async () => {
    await setup();
    (el.querySelector('[data-testid="qty-plus"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelector('[data-testid="qty-plus"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelector('[data-testid="reserve-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    // Reservar pide confirmación de la selección → aceptar en el modal.
    (el.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(reservations.create).toHaveBeenCalledWith('ev1', {
      quantities: [{ localityId: 'ga', quantity: 2 }],
    });
    expect(el.querySelector('[data-testid="reserved"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="countdown"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="share-box"]')).not.toBeNull();
  });

  it('continuar al pago sin sesión abre el modal de login', async () => {
    await setup();
    (el.querySelector('[data-testid="qty-plus"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelector('[data-testid="reserve-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelector('[data-testid="pay-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="login-modal"]')).not.toBeNull();
  });

  it('reserva bloqueada por límite (429): muestra advertencia + CTA de login', async () => {
    await setup();
    reservations.create.and.returnValue(
      throwError(() => ({ status: 429, error: { message: 'Ya tienes una reserva activa.' } })),
    );
    (el.querySelector('[data-testid="qty-plus"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelector('[data-testid="reserve-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const blocked = el.querySelector('[data-testid="reserve-blocked"]');
    expect(blocked).not.toBeNull();
    expect(blocked?.textContent).toContain('Ya tienes una reserva activa.');
    // NO es un error de sistema y la selección se conserva.
    expect(el.querySelector('[data-testid="purchase-error"]')).toBeNull();

    // Al iniciar sesión desde la advertencia, reintenta la reserva (ya con sesión).
    reservations.create.and.returnValue(of(RESERVATION as unknown as ReservationResponseDto));
    (el.querySelector('[data-testid="reserve-login"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="login-modal"]')).not.toBeNull();
  });

  it('traduce la interfaz al inglés al cambiar de idioma', async () => {
    await setup();
    expect(el.querySelector('h1')?.textContent).toContain('Comprar');
    TestBed.inject(I18nService).use('en');
    fixture.detectChanges();
    expect(el.querySelector('h1')?.textContent).toContain('Buy');
    expect(el.querySelector('[data-testid="reserve-btn"]')?.textContent).toContain('Reserve');
  });
});
