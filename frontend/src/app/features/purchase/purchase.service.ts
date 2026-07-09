import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ReservationsApi } from '../../core/api/reservations.api';
import type {
  CreateReservationDto,
  EventAvailabilityDto,
  LocalityAvailabilityDto,
  OrderResponseDto,
  ReservationResponseDto,
} from '../../core/api/types';

/** Tope anti-abuso por carrito (alineado con el backend). */
export const MAX_PER_CART = 50;

function toCents(price: string): number {
  return Math.round(parseFloat(price) * 100);
}
function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Estado de la compra de UN evento: selección → reserva ANÓNIMA (token
 * compartible) → checkout. La reserva no exige login; el login se pide al pagar.
 * Se provee a nivel de ruta para reiniciarse por visita.
 */
@Injectable()
export class PurchaseService {
  private readonly reservations = inject(ReservationsApi);

  readonly eventId = signal('');
  readonly availability = signal<EventAvailabilityDto | null>(null);

  private readonly seatSel = signal<ReadonlySet<string>>(new Set());
  private readonly qtySel = signal<ReadonlyMap<string, number>>(new Map());

  readonly selectedSeatIds = computed(() => [...this.seatSel()]);
  readonly selectedSet = computed<ReadonlySet<string>>(() => this.seatSel());

  /** La reserva creada (con token para compartir). */
  readonly reservation = signal<ReservationResponseDto | null>(null);

  readonly quantityLocalities = computed<LocalityAvailabilityDto[]>(() => {
    const av = this.availability();
    if (!av) return [];
    const withSeats = new Set(av.seats.map((s) => s.localityId));
    return av.localities.filter((l) => !withSeats.has(l.id));
  });

  maxFor(loc: LocalityAvailabilityDto): number {
    return Math.min(loc.available, MAX_PER_CART);
  }

  readonly totalCount = computed(() => {
    const qty = [...this.qtySel().values()].reduce((a, b) => a + b, 0);
    return this.seatSel().size + qty;
  });

  readonly totalCents = computed(() => {
    const av = this.availability();
    if (!av) return 0;
    const priceByLoc = new Map(av.localities.map((l) => [l.id, l.price ? toCents(l.price.total) : 0]));
    const seatLoc = new Map(av.seats.map((s) => [s.id, s.localityId]));
    let cents = 0;
    for (const seatId of this.seatSel()) cents += priceByLoc.get(seatLoc.get(seatId) ?? '') ?? 0;
    for (const [locId, n] of this.qtySel()) cents += (priceByLoc.get(locId) ?? 0) * n;
    return cents;
  });

  readonly totalDisplay = computed(() => fromCents(this.totalCents()));

  toggleSeat(seatId: string): void {
    const next = new Set(this.seatSel());
    if (next.has(seatId)) next.delete(seatId);
    else if (next.size < MAX_PER_CART) next.add(seatId);
    this.seatSel.set(next);
  }

  setQuantity(localityId: string, quantity: number): void {
    const next = new Map(this.qtySel());
    if (quantity <= 0) next.delete(localityId);
    else next.set(localityId, quantity);
    this.qtySel.set(next);
  }

  /**
   * Crea la reserva anónima (sin login). Por simplicidad, una reserva por
   * modo: asientos numerados seleccionados, o una localidad general por cantidad.
   */
  reserve(): Observable<ReservationResponseDto> {
    return this.reservations.create(this.eventId(), this.buildBody()).pipe(
      tap((res) => this.reservation.set(res)),
    );
  }

  private buildBody(): CreateReservationDto {
    if (this.seatSel().size > 0) return { seatIds: [...this.seatSel()] };
    const ga = [...this.qtySel().entries()].find(([, n]) => n > 0);
    if (ga) return { localityId: ga[0], quantity: ga[1] };
    return {};
  }

  /** Paga la reserva (requiere sesión): crea la orden a nombre del usuario. */
  checkout(): Observable<OrderResponseDto> {
    const token = this.reservation()?.token ?? '';
    return this.reservations.checkout(token);
  }
}
