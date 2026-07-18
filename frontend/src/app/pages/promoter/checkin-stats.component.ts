import { Component, OnDestroy, PLATFORM_ID, inject, input, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { ValidatorsApi, type CheckinStats } from '../../core/api/validators.api';

/**
 * Dashboard de check-ins en TIEMPO REAL (F5). Consume el endpoint de stats de F2
 * (`/events/:id/validators/checkin-stats`) por sondeo cada 5 s: avance %, entradas
 * por localidad y por validador, conflictos (dobles check-in) y timeline de últimos
 * escaneos. (Upgrade futuro: SSE en vez de polling.) Solo corre en navegador (SSR no).
 */
@Component({
  selector: 'app-checkin-stats',
  imports: [TranslatePipe],
  templateUrl: './checkin-stats.component.html',
})
export class CheckinStatsComponent implements OnDestroy {
  readonly eventId = input.required<string>();

  private readonly api = inject(ValidatorsApi);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly stats = signal<CheckinStats | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  private timer?: ReturnType<typeof setInterval>;

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;
    queueMicrotask(() => {
      this.load();
      this.timer = setInterval(() => this.load(), 5000); // tiempo real (polling)
    });
  }

  protected load(): void {
    this.api.checkinStats(this.eventId()).subscribe({
      next: (s) => {
        this.stats.set(s);
        this.loading.set(false);
        this.error.set(false);
      },
      error: () => {
        this.loading.set(false);
        // Conserva el último snapshot; solo marca error si nunca cargó.
        if (!this.stats()) this.error.set(true);
      },
    });
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
