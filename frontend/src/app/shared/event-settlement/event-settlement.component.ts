import { Component, computed, inject, input, effect, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import type { EventSettlementDto } from '../../core/api/types';

/**
 * Cuentas (liquidación) de un evento sobre sus órdenes pagadas. El ADMIN ve el
 * split completo (pasarela/plataforma/promotor + IVA); el PROMOTOR ve su neto y
 * cuánto se descuenta por cuota de servicio. Server-authoritative (endpoint
 * financiero); esta vista es solo presentación.
 */
@Component({
  selector: 'app-event-settlement',
  imports: [TranslatePipe],
  templateUrl: './event-settlement.component.html',
})
export class EventSettlementComponent {
  private readonly api = inject(PromoterEventsApi);

  /** Id del evento a liquidar. */
  readonly eventId = input.required<string>();
  /** true = mostrar el split interno completo (vista admin). */
  readonly showSplit = input(false);

  protected readonly data = signal<EventSettlementDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  protected readonly currency = computed(() => this.data()?.currency ?? 'GTQ');

  constructor() {
    effect(() => {
      const id = this.eventId();
      this.load(id);
    });
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(false);
    this.api.settlement(id).subscribe({
      next: (d) => {
        this.data.set(d);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }
}
