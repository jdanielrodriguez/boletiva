import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, of, tap } from 'rxjs';
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

/** Una línea del resumen de selección (removible antes de reservar). */
export interface SelectionItem {
  key: string; // clave estable para @for track
  kind: 'seat' | 'ga';
  refId: string; // seatId (numerado) o localityId (general)
  label: string; // etiqueta del asiento o nombre de la localidad
  localityName: string;
  qty: number; // 1 para asiento numerado; n para general
  amountDisplay: string; // total de la línea (Q)
}

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

  /** Localidad activa: se elige UNA a la vez (una localidad por reserva). */
  readonly activeLocalityId = signal<string | null>(null);

  readonly selectedSeatIds = computed(() => [...this.seatSel()]);
  readonly selectedSet = computed<ReadonlySet<string>>(() => this.seatSel());

  /** La reserva creada (con token para compartir). */
  readonly reservation = signal<ReservationResponseDto | null>(null);

  readonly localities = computed<LocalityAvailabilityDto[]>(
    () => this.availability()?.localities ?? [],
  );

  readonly activeLocality = computed<LocalityAvailabilityDto | null>(
    () => this.localities().find((l) => l.id === this.activeLocalityId()) ?? null,
  );

  /** Asientos (con coordenadas) de la localidad activa. */
  readonly activeSeats = computed(() => {
    const id = this.activeLocalityId();
    return (this.availability()?.seats ?? []).filter((s) => s.localityId === id);
  });

  /** true si la localidad activa es numerada (tiene asientos con coordenadas). */
  readonly activeIsSeated = computed(() => this.activeSeats().length > 0);

  /** Cambia la localidad en vista. La selección se ACUMULA entre localidades
   * (se permite comprar varias localidades a la vez). */
  setActiveLocality(id: string): void {
    this.activeLocalityId.set(id);
  }

  /** Reinicia la selección (p.ej. tras reservar o cambiar de vista). */
  clearSelection(): void {
    this.seatSel.set(new Set());
    this.qtySel.set(new Map());
  }

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

  /**
   * Resumen desglosado de TODA la selección (asientos numerados + cantidades
   * generales) de TODAS las localidades, removible una a una antes de reservar.
   * Resuelve el caso "seleccioné de más en otra localidad y no la veía".
   */
  readonly selectionItems = computed<SelectionItem[]>(() => {
    const av = this.availability();
    if (!av) return [];
    const locById = new Map(av.localities.map((l) => [l.id, l]));
    const seatById = new Map(av.seats.map((s) => [s.id, s]));
    const items: SelectionItem[] = [];
    for (const seatId of this.seatSel()) {
      const s = seatById.get(seatId);
      const loc = s ? locById.get(s.localityId) : undefined;
      const cents = loc?.price ? toCents(loc.price.total) : 0;
      items.push({
        key: `seat:${seatId}`,
        kind: 'seat',
        refId: seatId,
        label: s?.label ?? seatId.slice(0, 8),
        localityName: loc?.name ?? '',
        qty: 1,
        amountDisplay: fromCents(cents),
      });
    }
    for (const [locId, n] of this.qtySel()) {
      if (n <= 0) continue;
      const loc = locById.get(locId);
      const cents = (loc?.price ? toCents(loc.price.total) : 0) * n;
      items.push({
        key: `ga:${locId}`,
        kind: 'ga',
        refId: locId,
        label: loc?.name ?? locId.slice(0, 8),
        localityName: loc?.name ?? '',
        qty: n,
        amountDisplay: fromCents(cents),
      });
    }
    return items;
  });

  /** Quita una línea del resumen (un asiento numerado o toda una general). */
  removeSelection(item: SelectionItem): void {
    if (item.kind === 'seat') this.toggleSeat(item.refId);
    else this.setQuantity(item.refId, 0);
  }

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

  /** Cantidad seleccionada actual para una localidad (0 si ninguna). */
  quantityFor(localityId: string): number {
    return this.qtySel().get(localityId) ?? 0;
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
    const body: CreateReservationDto = {};
    if (this.seatSel().size > 0) body.seatIds = [...this.seatSel()];
    const quantities = [...this.qtySel().entries()]
      .filter(([, n]) => n > 0)
      .map(([localityId, quantity]) => ({ localityId, quantity }));
    if (quantities.length > 0) body.quantities = quantities;
    return body;
  }

  /** Paga la reserva (requiere sesión): crea la orden a nombre del usuario. */
  checkout(billing?: { billingNit?: string; billingName?: string }): Observable<OrderResponseDto> {
    const token = this.reservation()?.token ?? '';
    return this.reservations.checkout(token, billing);
  }

  /**
   * Cancela la reserva actual en el backend (libera los cupos e inicia el cooldown
   * anti-abuso para visitantes) y limpia el estado local. No falla si no hay token.
   */
  cancel(): Observable<{ cancelled: boolean }> {
    const token = this.reservation()?.token ?? '';
    this.reservation.set(null);
    if (!token) return of({ cancelled: false });
    return this.reservations.cancel(token);
  }
}
