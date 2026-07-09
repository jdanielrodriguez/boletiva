import { Component, computed, input } from '@angular/core';
import type { ReservationItemDto } from '../../core/api/types';

interface Group {
  localityName: string;
  items: ReservationItemDto[];
  subtotal: string;
}

/**
 * Ficha técnica de los boletos de una reserva: AGRUPA por localidad y muestra la
 * info de cada boleto (mesa/fila/asiento cuando aplica, o el código GA). Se usa
 * en la pantalla de compra (estado reservado) y en la reserva compartida.
 */
@Component({
  selector: 'app-reservation-items',
  templateUrl: './reservation-items.component.html',
})
export class ReservationItems {
  readonly items = input<ReservationItemDto[]>([]);

  protected readonly groups = computed<Group[]>(() => {
    const byLoc = new Map<string, ReservationItemDto[]>();
    for (const it of this.items()) {
      const arr = byLoc.get(it.localityName) ?? [];
      arr.push(it);
      byLoc.set(it.localityName, arr);
    }
    return [...byLoc.entries()].map(([localityName, items]) => {
      const cents = items.reduce((a, it) => a + Math.round(parseFloat(it.price.total) * 100), 0);
      return { localityName, items, subtotal: (cents / 100).toFixed(2) };
    });
  });

  /** Descripción del boleto: "Mesa X · Fila Y · Asiento Z", o el código GA. */
  protected seatDesc(it: ReservationItemDto): string {
    if (!it.section && !it.row) return it.label;
    const parts: string[] = [];
    if (it.section) parts.push(it.section);
    if (it.row) parts.push(`Fila ${it.row}`);
    parts.push(`Asiento ${it.label}`);
    return parts.join(' · ');
  }
}
