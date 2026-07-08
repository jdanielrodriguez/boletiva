import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { EventsApi } from '../../core/api/events.api';
import { SessionStore } from '../../core/auth/session.store';
import { InventoryApi } from '../../core/api/inventory.api';
import { OrdersApi } from '../../core/api/orders.api';
import type { EventAvailabilityDto, PublicEventDetailDto } from '../../core/api/types';
import { PurchasePage } from './purchase.page';

const EVENT = { id: 'ev1', name: 'Fiesta', slug: 'fiesta', media: [], localities: [] };
const AVAIL = {
  seatMap: null,
  localities: [
    {
      id: 'ga',
      name: 'General',
      slug: 'general',
      kind: 'general',
      capacity: 100,
      available: 80,
      price: { currency: 'GTQ', net: '75.00', serviceFee: '12.36', iva: '9.90', total: '97.26' },
    },
  ],
  seats: [],
};

describe('PurchasePage (camino por cantidad)', () => {
  let fixture: ComponentFixture<PurchasePage>;
  let el: HTMLElement;
  let inventory: jasmine.SpyObj<InventoryApi>;

  async function setup() {
    const events = jasmine.createSpyObj<EventsApi>('EventsApi', ['getBySlug', 'availability']);
    events.getBySlug.and.returnValue(of(EVENT as unknown as PublicEventDetailDto));
    events.availability.and.returnValue(of(AVAIL as unknown as EventAvailabilityDto));
    inventory = jasmine.createSpyObj<InventoryApi>('InventoryApi', ['hold', 'release']);
    inventory.release.and.returnValue(of({ released: 0 }));
    const orders = jasmine.createSpyObj<OrdersApi>('OrdersApi', ['create']);

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: EventsApi, useValue: events },
        { provide: InventoryApi, useValue: inventory },
        { provide: OrdersApi, useValue: orders },
        {
          provide: SessionStore,
          useValue: { ensureLoaded: () => of({ id: 'u1' }), isEmailVerified: () => true },
        },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ slug: 'fiesta' })) } },
      ],
    });
    fixture = TestBed.createComponent(PurchasePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  afterEach(() => fixture?.destroy());

  it('muestra selector por cantidad para localidad sin mapa', async () => {
    await setup();
    expect(el.querySelector('[data-testid="loc-quantity"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="reserve-btn"]')).not.toBeNull();
  });

  it('reservar hace hold y pasa a estado reservado con countdown', async () => {
    await setup();
    inventory.hold.and.returnValue(
      of({
        seatIds: ['g1', 'g2'],
        holderId: 'u',
        ttlSeconds: 600,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      }),
    );

    const select = el.querySelector('.loc-quantity select') as HTMLSelectElement;
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    (el.querySelector('[data-testid="reserve-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(inventory.hold).toHaveBeenCalledWith('ev1', { localityId: 'ga', quantity: 2 });
    expect(el.querySelector('[data-testid="countdown"]')).not.toBeNull();
  });
});
