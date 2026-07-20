import { Component, computed, inject, input, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { ReservationItemDto } from '../../core/api/types';
import { PagerComponent } from '../ui/pager.component';
import { MoneyPipe } from '../money.pipe';

interface Group {
  localityName: string;
  /** Boletos de esta localidad visibles en la PÁGINA actual. */
  items: ReservationItemDto[];
  /** Total de boletos de la localidad (toda la reserva, no solo la página). */
  count: number;
  /** Subtotal de TODA la localidad (no solo la página). */
  subtotal: string;
}

/**
 * Ficha técnica de los boletos de una reserva: AGRUPA por localidad y muestra la
 * info de cada boleto (mesa/fila/asiento cuando aplica, o el código GA). Se usa
 * en la pantalla de compra (estado reservado) y en la reserva compartida.
 *
 * v3.8/G3: diseño más aireado (cards por localidad + boletos como filas con icono)
 * y PAGINACIÓN cuando la reserva trae muchos boletos (reusa `app-pager`). El
 * subtotal y el conteo por localidad se calculan sobre TODA la reserva, no sobre
 * la página visible.
 */
@Component({
  selector: 'app-reservation-items',
  imports: [TranslatePipe, PagerComponent, MoneyPipe],
  templateUrl: './reservation-items.component.html',
})
export class ReservationItems {
  readonly items = input<ReservationItemDto[]>([]);
  /** Boletos por página (se pagina solo si se superan). */
  readonly pageSize = input(12);
  private readonly translate = inject(TranslateService);

  protected readonly page = signal(1);

  /** Subtotal + conteo por localidad, sobre TODA la reserva. */
  private readonly fullByLoc = computed(() => {
    const map = new Map<string, { count: number; subtotal: string }>();
    const byLoc = new Map<string, ReservationItemDto[]>();
    for (const it of this.items()) {
      const arr = byLoc.get(it.localityName) ?? [];
      arr.push(it);
      byLoc.set(it.localityName, arr);
    }
    for (const [name, arr] of byLoc) {
      const cents = arr.reduce((a, it) => a + Math.round(parseFloat(it.price.total) * 100), 0);
      map.set(name, { count: arr.length, subtotal: (cents / 100).toFixed(2) });
    }
    return map;
  });

  /** Lista aplanada en orden de localidad (base de la paginación). */
  private readonly flat = computed(() => {
    const order: string[] = [];
    const byLoc = new Map<string, ReservationItemDto[]>();
    for (const it of this.items()) {
      if (!byLoc.has(it.localityName)) order.push(it.localityName);
      const arr = byLoc.get(it.localityName) ?? [];
      arr.push(it);
      byLoc.set(it.localityName, arr);
    }
    return order.flatMap((name) => byLoc.get(name) ?? []);
  });

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.flat().length / this.pageSize())),
  );

  /** Página actual clamped al rango válido (por si cambia la reserva). */
  protected readonly currentPage = computed(() => Math.min(this.page(), this.totalPages()));

  /** Grupos por localidad de la PÁGINA visible (con subtotal/conteo totales). */
  protected readonly groups = computed<Group[]>(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    const pageItems = this.flat().slice(start, start + this.pageSize());
    const order: string[] = [];
    const byLoc = new Map<string, ReservationItemDto[]>();
    for (const it of pageItems) {
      if (!byLoc.has(it.localityName)) order.push(it.localityName);
      const arr = byLoc.get(it.localityName) ?? [];
      arr.push(it);
      byLoc.set(it.localityName, arr);
    }
    const full = this.fullByLoc();
    return order.map((name) => ({
      localityName: name,
      items: byLoc.get(name) ?? [],
      count: full.get(name)?.count ?? 0,
      subtotal: full.get(name)?.subtotal ?? '0.00',
    }));
  });

  protected goToPage(p: number): void {
    this.page.set(Math.min(Math.max(1, p), this.totalPages()));
  }

  /** Descripción del boleto: "Mesa X · Fila Y · Asiento Z", o el código GA. */
  protected seatDesc(it: ReservationItemDto): string {
    if (!it.section && !it.row) return it.label;
    const parts: string[] = [];
    if (it.section) parts.push(it.section);
    if (it.row) parts.push(this.translate.instant('reservation.rowLabel', { n: it.row }));
    parts.push(this.translate.instant('reservation.seatLabel', { n: it.label }));
    return parts.join(' · ');
  }
}
