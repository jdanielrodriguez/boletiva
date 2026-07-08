import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { InventoryApi } from '../../core/api/inventory.api';
import { OrdersApi } from '../../core/api/orders.api';
import type { CreateHoldDto, EventAvailabilityDto, OrderResponseDto } from '../../core/api/types';
import { PurchaseService } from './purchase.service';

const AVAIL = {
  seatMap: null,
  localities: [
    { id: 'ga', name: 'General', slug: 'general', kind: 'general', capacity: 100, available: 80, price: { currency: 'GTQ', net: '75.00', serviceFee: '12.36', iva: '9.90', total: '97.26' } },
    { id: 'vip', name: 'VIP', slug: 'vip', kind: 'seated', capacity: 20, available: 2, price: { currency: 'GTQ', net: '100.00', serviceFee: '16.48', iva: '13.20', total: '129.68' } },
  ],
  seats: [
    { id: 's1', localityId: 'vip', label: 'A-1', section: null, row: 'A', x: 10, y: 10, status: 'available' },
    { id: 's2', localityId: 'vip', label: 'A-2', section: null, row: 'A', x: 20, y: 10, status: 'available' },
  ],
} as unknown as EventAvailabilityDto;

describe('PurchaseService', () => {
  let store: PurchaseService;
  let inventory: jasmine.SpyObj<InventoryApi>;
  let orders: jasmine.SpyObj<OrdersApi>;

  beforeEach(() => {
    inventory = jasmine.createSpyObj<InventoryApi>('InventoryApi', ['hold', 'release']);
    orders = jasmine.createSpyObj<OrdersApi>('OrdersApi', ['create']);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        PurchaseService,
        { provide: InventoryApi, useValue: inventory },
        { provide: OrdersApi, useValue: orders },
      ],
    });
    store = TestBed.inject(PurchaseService);
    store.eventId.set('ev1');
    store.availability.set(AVAIL);
  });

  it('quantityLocalities excluye localidades con asientos (mapa)', () => {
    expect(store.quantityLocalities().map((l) => l.id)).toEqual(['ga']);
  });

  it('maxFor = min(disponibles, 50)', () => {
    expect(store.maxFor(AVAIL.localities[0])).toBe(50); // 80 → 50
    expect(store.maxFor(AVAIL.localities[1])).toBe(2); // 2 → 2
  });

  it('totales combinan asiento + cantidad (en centavos, sin float)', () => {
    store.toggleSeat('s1'); // 129.68
    store.setQuantity('ga', 2); // 97.26 * 2 = 194.52
    expect(store.totalCount()).toBe(3);
    expect(store.totalDisplay()).toBe('324.20');
  });

  it('toggleSeat agrega y quita', () => {
    store.toggleSeat('s1');
    expect(store.selectedSeatIds()).toEqual(['s1']);
    store.toggleSeat('s1');
    expect(store.selectedSeatIds()).toEqual([]);
  });

  it('hold agrega seatIds de todos los holds y toma el expiresAt más próximo', (done) => {
    store.toggleSeat('s1');
    store.setQuantity('ga', 2);
    inventory.hold.and.callFake((_eventId: string, body: CreateHoldDto) => {
      if (body.seatIds) return of({ seatIds: ['s1'], holderId: 'u', ttlSeconds: 600, expiresAt: '2026-07-08T18:50:00.000Z' });
      return of({ seatIds: ['g1', 'g2'], holderId: 'u', ttlSeconds: 600, expiresAt: '2026-07-08T18:40:00.000Z' });
    });
    store.hold().subscribe((seatIds) => {
      expect(seatIds.sort()).toEqual(['g1', 'g2', 's1']);
      expect(store.heldSeatIds().sort()).toEqual(['g1', 'g2', 's1']);
      expect(store.expiresAt()).toBe(new Date('2026-07-08T18:40:00.000Z').getTime());
      done();
    });
  });

  it('createOrder envía los seatIds reservados', () => {
    store.heldSeatIds.set(['s1', 'g1']);
    orders.create.and.returnValue(of({ id: 'o1' } as unknown as OrderResponseDto));
    store.createOrder().subscribe();
    expect(orders.create).toHaveBeenCalledWith('ev1', { seatIds: ['s1', 'g1'] });
  });

  it('release libera los holds propios y limpia el estado', () => {
    store.heldSeatIds.set(['s1']);
    inventory.release.and.returnValue(of({ released: 1 }));
    store.release();
    expect(inventory.release).toHaveBeenCalledWith('ev1', ['s1']);
    expect(store.heldSeatIds()).toEqual([]);
  });
});
