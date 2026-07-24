import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { ReservationsApi } from '../../core/api/reservations.api';
import type {
  CreateReservationDto,
  EventAvailabilityDto,
  LocalityAvailabilityDto,
  OrderResponseDto,
  ReservationResponseDto,
} from '../../core/api/types';
import type { MapDecorations, MapRegion } from './seat-map.component';

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

  /** true si hay una localidad activa y es GENERAL (sin mapa → se compra por cantidad). */
  readonly activeIsGeneral = computed(() => !!this.activeLocality() && !this.activeIsSeated());

  /** TODOS los asientos con coordenadas del evento → mapa UNIDO (vista general del recinto). */
  readonly allSeats = computed(() =>
    (this.availability()?.seats ?? []).filter((s) => s.x != null && s.y != null),
  );

  /** Nombre de localidad por id (para el CTA al pasar el cursor sobre el mapa unido). */
  readonly localityNames = computed<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const l of this.localities()) m[l.id] = l.name;
    return m;
  });

  /** Precio del comprador por localidad (id → "123.45") para el tooltip del asiento. */
  readonly priceByLocality = computed<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const l of this.localities()) if (l.price) m[l.id] = l.price.total;
    return m;
  });

  /** ¿Hay al menos una localidad con asientos (mapa)? → muestra el mapa del recinto. */
  readonly hasSeatedMap = computed(() => this.allSeats().length > 0);

  /** Decoraciones del recinto (escenario/FOH/PLATEA/etiquetas/cruces) desde SeatMap.layout. */
  readonly decorations = computed<MapDecorations | null>(
    () => (this.availability()?.seatMap?.layout as MapDecorations | undefined) ?? null,
  );

  /** Regiones de localidades SIN asientos (Generales), mapeadas por slug→id + activa. */
  readonly regions = computed<MapRegion[]>(() => {
    const layout = this.availability()?.seatMap?.layout as
      | { regions?: (Omit<MapRegion, 'id' | 'active'> & { slug: string })[] }
      | undefined;
    const raw = layout?.regions ?? [];
    const active = this.activeLocalityId();
    const bySlug = new Map(this.localities().map((l) => [l.slug, l.id]));
    return raw
      .filter((r) => bySlug.has(r.slug))
      .map((r) => {
        const id = bySlug.get(r.slug) as string;
        return { id, x: r.x, y: r.y, w: r.w, h: r.h, label: r.label, arc: r.arc, active: id === active };
      });
  });

  /** Localidades que se dibujan como MESAS (círculos): las que se llaman "Mesa(s)…". */
  readonly tableLocalityIds = computed<ReadonlySet<string>>(
    () => new Set(this.localities().filter((l) => /mesa/i.test(l.name)).map((l) => l.id)),
  );

  /**
   * Id de la localidad activa SOLO si es numerada (tiene asientos en el mapa). Es lo
   * que la cámara enfoca y lo que se puede seleccionar; null = vista lejana / sin foco
   * (p.ej. nada seleccionado, o una localidad general activa → el mapa no se enfoca).
   */
  readonly activeSeatedLocalityId = computed<string | null>(() => {
    const id = this.activeLocalityId();
    if (!id) return null;
    return this.allSeats().some((s) => s.localityId === id) ? id : null;
  });

  /** Cambia la localidad en vista. La selección se ACUMULA entre localidades
   * (se permite comprar varias localidades a la vez). */
  setActiveLocality(id: string): void {
    this.activeLocalityId.set(id);
  }

  /** Salir de la zona enfocada → vuelve al overview (localidades). */
  deselectLocality(): void {
    this.activeLocalityId.set(null);
  }

  /**
   * Aplica un delta de disponibilidad en vivo (SSE, FU11): marca `sold` como no
   * disponibles y `released` como disponibles. Si un asiento seleccionado se vendió,
   * lo quita de la selección (evita reservar algo ya tomado por otro comprador).
   */
  applySeatDelta(delta: { sold?: string[]; released?: string[] }): void {
    const av = this.availability();
    if (!av?.seats?.length) return;
    const sold = new Set(delta.sold ?? []);
    const released = new Set(delta.released ?? []);
    if (sold.size === 0 && released.size === 0) return;
    const seats = av.seats.map((s) =>
      sold.has(s.id) ? { ...s, status: 'sold' } : released.has(s.id) ? { ...s, status: 'available' } : s,
    );
    this.availability.set({ ...av, seats } as typeof av);
    if (sold.size > 0 && [...this.seatSel()].some((id) => sold.has(id))) {
      const next = new Set([...this.seatSel()].filter((id) => !sold.has(id)));
      this.seatSel.set(next);
    }
  }

  /** Reinicia la selección (p.ej. tras reservar o cambiar de vista). */
  clearSelection(): void {
    this.seatSel.set(new Set());
    this.qtySel.set(new Map());
  }

  /**
   * Cap EFECTIVO de boletos por compra (F4): el mínimo entre el tope global del
   * carrito y el `maxPerOrder` que el promotor fijó en el evento (null = solo el
   * global). Es la fuente de verdad de la UI; el backend lo re-valida en hold/commit.
   */
  readonly effectiveMax = computed(() => {
    const m = this.availability()?.maxPerOrder ?? null;
    return m != null && m > 0 ? Math.min(MAX_PER_CART, m) : MAX_PER_CART;
  });

  maxFor(loc: LocalityAvailabilityDto): number {
    return Math.min(loc.available, this.effectiveMax());
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
    // Cap por el TOTAL de la selección (asientos + generales) contra el máximo
    // efectivo del evento (F4): no se puede seleccionar de más.
    if (next.has(seatId)) next.delete(seatId);
    else if (this.totalCount() < this.effectiveMax()) next.add(seatId);
    this.seatSel.set(next);
  }

  setQuantity(localityId: string, quantity: number): void {
    const next = new Map(this.qtySel());
    if (quantity <= 0) {
      next.delete(localityId);
      this.qtySel.set(next);
      return;
    }
    // Clamp (F4): no exceder ni la disponibilidad de la localidad ni el presupuesto
    // restante del tope efectivo del evento (contando lo ya seleccionado en otras).
    const loc = this.localities().find((l) => l.id === localityId);
    const usedElsewhere = this.totalCount() - this.quantityFor(localityId);
    const budget = Math.max(0, this.effectiveMax() - usedElsewhere);
    const localMax = loc ? Math.min(loc.available, budget) : budget;
    const clamped = Math.max(0, Math.min(quantity, localMax));
    if (clamped <= 0) next.delete(localityId);
    else next.set(localityId, clamped);
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
  reserve(captchaToken?: string): Observable<ReservationResponseDto> {
    return this.reservations.create(this.eventId(), this.buildBody(), captchaToken).pipe(
      tap((res) => {
        this.reservation.set(res);
        this.persist(res); // sobrevive a un F5 (se rehidrata con restore())
      }),
    );
  }

  // --- Persistencia de la reserva viva (anti-F5) ---------------------------------
  // La reserva vive en el backend (holds Redis, TTL) con un token; guardamos SOLO
  // ese token en localStorage (por evento) para reanudarla tras recargar la página.
  // El estado real siempre se revalida contra el backend (fuente de verdad).

  private storageKey(eventId: string): string {
    return `pe.reservation.${eventId}`;
  }

  /** Acceso a localStorage tolerante a SSR / modo privado (devuelve null si no hay). */
  private ls(): Storage | null {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  }

  private persist(res: ReservationResponseDto): void {
    const ls = this.ls();
    if (!ls) return;
    try {
      ls.setItem(this.storageKey(res.eventId), res.token);
    } catch {
      /* cuota llena o almacenamiento bloqueado: no es crítico */
    }
  }

  /** Borra la reserva persistida del evento actual (al pagar, cancelar o expirar). */
  clearPersisted(): void {
    const ls = this.ls();
    const id = this.eventId();
    if (!ls || !id) return;
    try {
      ls.removeItem(this.storageKey(id));
    } catch {
      /* noop */
    }
  }

  /**
   * Rehidrata una reserva viva tras un F5: lee el token guardado del evento y lo
   * revalida contra el backend. Si sigue viva la restaura en memoria y la devuelve;
   * si expiró / ya no existe, limpia el rastro y devuelve null.
   */
  restore(): Observable<ReservationResponseDto | null> {
    const ls = this.ls();
    const id = this.eventId();
    const token = ls && id ? ls.getItem(this.storageKey(id)) : null;
    if (!token) return of(null);
    return this.reservations.getByToken(token).pipe(
      map((res) => {
        const alive = res.valid && this.remainingMs(res.expiresAt) > 0;
        if (alive) {
          this.reservation.set(res);
          return res;
        }
        this.clearPersisted();
        return null;
      }),
      catchError(() => {
        this.clearPersisted(); // 404 / inválida → borrar el rastro
        return of(null);
      }),
    );
  }

  private remainingMs(expiresAt?: string | null): number {
    return expiresAt ? new Date(expiresAt).getTime() - Date.now() : 0;
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
    // La reserva se convirtió en orden → ya no hay que reanudarla tras un F5.
    return this.reservations.checkout(token, billing).pipe(tap(() => this.clearPersisted()));
  }

  /**
   * Cancela la reserva actual en el backend (libera los cupos e inicia el cooldown
   * anti-abuso para visitantes) y limpia el estado local. No falla si no hay token.
   */
  cancel(): Observable<{ cancelled: boolean }> {
    const token = this.reservation()?.token ?? '';
    this.reservation.set(null);
    this.clearPersisted();
    if (!token) return of({ cancelled: false });
    return this.reservations.cancel(token);
  }
}
