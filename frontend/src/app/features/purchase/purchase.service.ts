import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, forkJoin, map, of, tap } from 'rxjs';
import { InventoryApi } from '../../core/api/inventory.api';
import { OrdersApi } from '../../core/api/orders.api';
import type {
  CreateHoldDto,
  EventAvailabilityDto,
  HoldResponseDto,
  LocalityAvailabilityDto,
  OrderResponseDto,
} from '../../core/api/types';

/** Tope anti-abuso por carrito (alineado con el backend: Max(50) en el hold). */
export const MAX_PER_CART = 50;

/** Convierte un precio string ("129.68") a centavos enteros (evita float). */
function toCents(price: string): number {
  return Math.round(parseFloat(price) * 100);
}

function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Estado de la compra de UN evento (selección → hold → orden). Se provee a nivel
 * de la ruta de compra (no root) para que se reinicie en cada visita.
 * - Localidades CON asientos (coordenadas) → selección por asiento.
 * - Localidades SIN mapa (default) → selección por CANTIDAD, tope
 *   min(disponibles, 50) = máximo de boletos permitidos por localidad.
 */
@Injectable()
export class PurchaseService {
  private readonly inventory = inject(InventoryApi);
  private readonly orders = inject(OrdersApi);

  readonly eventId = signal('');
  readonly availability = signal<EventAvailabilityDto | null>(null);

  /** Asientos numerados seleccionados (seatId). */
  private readonly seatSel = signal<ReadonlySet<string>>(new Set());
  /** Cantidad por localidad general (localityId → n). */
  private readonly qtySel = signal<ReadonlyMap<string, number>>(new Map());

  readonly selectedSeatIds = computed(() => [...this.seatSel()]);
  readonly selectedSet = computed<ReadonlySet<string>>(() => this.seatSel());
  readonly quantities = computed(() => this.qtySel());

  /** Localidades que se muestran como selector por cantidad (sin asientos con coords). */
  readonly quantityLocalities = computed<LocalityAvailabilityDto[]>(() => {
    const av = this.availability();
    if (!av) return [];
    const withSeats = new Set(av.seats.map((s) => s.localityId));
    return av.localities.filter((l) => !withSeats.has(l.id));
  });

  /** Máximo de boletos seleccionables en una localidad (tope de boletos permitidos). */
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

  // --- Hold + countdown ---
  readonly heldSeatIds = signal<string[]>([]);
  readonly expiresAt = signal<number | null>(null);

  toggleSeat(seatId: string): void {
    const next = new Set(this.seatSel());
    if (next.has(seatId)) next.delete(seatId);
    else if (next.size + this.totalCount() - this.seatSel().size < MAX_PER_CART) next.add(seatId);
    this.seatSel.set(next);
  }

  setQuantity(localityId: string, quantity: number): void {
    const next = new Map(this.qtySel());
    if (quantity <= 0) next.delete(localityId);
    else next.set(localityId, quantity);
    this.qtySel.set(next);
  }

  /**
   * Reserva todo lo seleccionado. Un hold por localidad GA (por cantidad) + un
   * hold con todos los asientos numerados; agrega los seatIds concretos y
   * arranca el countdown con el expiresAt más próximo.
   */
  hold(): Observable<string[]> {
    const eventId = this.eventId();
    const calls: Observable<HoldResponseDto>[] = [];
    if (this.seatSel().size > 0) {
      calls.push(this.inventory.hold(eventId, { seatIds: [...this.seatSel()] } as CreateHoldDto));
    }
    for (const [localityId, quantity] of this.qtySel()) {
      calls.push(this.inventory.hold(eventId, { localityId, quantity } as CreateHoldDto));
    }
    if (calls.length === 0) return of([]);

    return forkJoin(calls).pipe(
      map((results) => ({
        seatIds: results.flatMap((r) => r.seatIds),
        expiresAt: Math.min(...results.map((r) => new Date(r.expiresAt).getTime())),
      })),
      tap(({ seatIds, expiresAt }) => {
        this.heldSeatIds.set(seatIds);
        this.expiresAt.set(expiresAt);
      }),
      map(({ seatIds }) => seatIds),
    );
  }

  /** Commit: crea la orden con los asientos ya reservados. */
  createOrder(): Observable<OrderResponseDto> {
    return this.orders.create(this.eventId(), { seatIds: this.heldSeatIds() });
  }

  /** Libera la reserva (best-effort al salir o expirar). */
  release(): void {
    const seatIds = this.heldSeatIds();
    if (seatIds.length === 0) return;
    this.inventory.release(this.eventId(), seatIds).subscribe({ error: () => undefined });
    this.heldSeatIds.set([]);
    this.expiresAt.set(null);
  }
}
