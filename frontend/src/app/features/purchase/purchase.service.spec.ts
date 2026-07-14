import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ReservationsApi } from '../../core/api/reservations.api';
import type { CreateReservationDto, EventAvailabilityDto, OrderResponseDto, ReservationResponseDto } from '../../core/api/types';
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

const RESERVATION = { token: 'tok-123', valid: true, expiresAt: '2028-01-01T00:00:00.000Z', items: [], total: '0.00' } as unknown as ReservationResponseDto;

describe('PurchaseService', () => {
  let store: PurchaseService;
  let api: jasmine.SpyObj<ReservationsApi>;

  beforeEach(() => {
    api = jasmine.createSpyObj<ReservationsApi>('ReservationsApi', ['create', 'getByToken', 'checkout']);
    api.create.and.returnValue(of(RESERVATION));
    api.checkout.and.returnValue(of({ id: 'o1' } as unknown as OrderResponseDto));
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), PurchaseService, { provide: ReservationsApi, useValue: api }],
    });
    store = TestBed.inject(PurchaseService);
    store.eventId.set('ev1');
    store.availability.set(AVAIL);
  });

  it('localidad activa: cambiarla NO limpia la selección (multi-localidad)', () => {
    expect(store.localities().map((l) => l.id)).toEqual(['ga', 'vip']);
    store.setActiveLocality('vip');
    expect(store.activeIsSeated()).toBe(true);
    expect(store.activeSeats().map((s) => s.id)).toEqual(['s1', 's2']);
    store.toggleSeat('s1');
    store.setActiveLocality('ga');
    expect(store.activeIsSeated()).toBe(false);
    store.setQuantity('ga', 2);
    // La selección de VIP se mantiene → se compran varias localidades a la vez.
    expect(store.selectedSeatIds()).toEqual(['s1']);
    expect(store.totalCount()).toBe(3);
  });

  it('maxFor = min(disponibles, 50)', () => {
    expect(store.maxFor(AVAIL.localities[0])).toBe(50);
    expect(store.maxFor(AVAIL.localities[1])).toBe(2);
  });

  it('totales combinan asiento + cantidad en centavos', () => {
    store.toggleSeat('s1');
    store.setQuantity('ga', 2);
    expect(store.totalCount()).toBe(3);
    expect(store.totalDisplay()).toBe('324.20');
  });

  it('reserve con asientos → create {seatIds} y guarda la reserva', (done) => {
    store.toggleSeat('s1');
    store.reserve().subscribe(() => {
      const body = api.create.calls.mostRecent().args[1] as CreateReservationDto;
      expect(body.seatIds).toEqual(['s1']);
      expect(store.reservation()?.token).toBe('tok-123');
      done();
    });
  });

  it('reserve por cantidad → create con quantities[]', (done) => {
    store.setQuantity('ga', 2);
    store.reserve().subscribe(() => {
      const body = api.create.calls.mostRecent().args[1] as CreateReservationDto;
      expect(body.quantities).toEqual([{ localityId: 'ga', quantity: 2 }]);
      done();
    });
  });

  it('checkout usa el token de la reserva', (done) => {
    store.reservation.set(RESERVATION);
    store.checkout().subscribe(() => {
      expect(api.checkout).toHaveBeenCalledWith('tok-123');
      done();
    });
  });

  it('selectionItems desglosa toda la selección y removeSelection la quita 1 a 1', () => {
    store.toggleSeat('s1'); // VIP A-1
    store.setQuantity('ga', 3); // 3 generales
    const items = store.selectionItems();
    expect(items.length).toBe(2);
    const seat = items.find((i) => i.kind === 'seat')!;
    const ga = items.find((i) => i.kind === 'ga')!;
    expect(seat.label).toBe('A-1');
    expect(seat.localityName).toBe('VIP');
    expect(seat.amountDisplay).toBe('129.68');
    expect(ga.qty).toBe(3);
    expect(ga.amountDisplay).toBe('291.78'); // 97.26 × 3
    expect(store.totalCount()).toBe(4);
    // Quitar el asiento numerado.
    store.removeSelection(seat);
    expect(store.selectionItems().some((i) => i.kind === 'seat')).toBe(false);
    // Quitar la línea general completa.
    store.removeSelection(ga);
    expect(store.selectionItems().length).toBe(0);
    expect(store.totalCount()).toBe(0);
  });
});
