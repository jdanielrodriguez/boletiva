import { Component, OnDestroy, PLATFORM_ID, inject, input, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { ValidatorsApi, type CheckinStats } from '../../core/api/validators.api';
import { API_BASE_URL } from '../../core/config/api.tokens';
import { TokenStore } from '../../core/auth/token-store.service';

/**
 * Dashboard de check-ins en TIEMPO REAL (F5). Consume el endpoint de stats
 * (`/events/:id/validators/checkin-stats`). Actualización EN VIVO por SSE
 * (`/checkin-stream`): en cada validación el backend empuja un evento y el dashboard
 * recarga las stats al instante — sin polling agresivo. Un sondeo LENTO (25 s) queda
 * como red de seguridad si el SSE cae. Solo corre en navegador (SSR no).
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
  private readonly baseUrl = inject(API_BASE_URL);
  private readonly tokens = inject(TokenStore);

  protected readonly stats = signal<CheckinStats | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  private timer?: ReturnType<typeof setInterval>;
  private es?: EventSource;

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;
    queueMicrotask(() => {
      this.load();
      this.openStream();
      this.timer = setInterval(() => this.load(), 25000); // fallback lento (SSE es el primario)
    });
  }

  /** Abre el SSE del evento: en cada `checkin` recarga las stats (tiempo real). */
  private openStream(): void {
    const token = this.tokens.getAccessToken();
    if (!token || typeof EventSource === 'undefined') return; // sin token o SSR → solo polling
    try {
      this.es = new EventSource(
        `${this.baseUrl}/events/${this.eventId()}/validators/checkin-stream?access_token=${encodeURIComponent(token)}`,
      );
      // El backend emite eventos con nombre `checkin` (y `ready` al abrir).
      this.es.addEventListener('checkin', () => this.load());
      this.es.onerror = () => {
        // Reconexión la maneja EventSource; el polling lento cubre el hueco.
      };
    } catch {
      /* si el SSE no abre, el polling lento mantiene el dashboard */
    }
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
    this.es?.close();
  }
}
