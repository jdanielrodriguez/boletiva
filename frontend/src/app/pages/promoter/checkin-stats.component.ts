import { Component, OnDestroy, PLATFORM_ID, inject, input, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { ValidatorsApi, type CheckinStats } from '../../core/api/validators.api';
import { API_BASE_URL } from '../../core/config/api.tokens';

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

  protected readonly stats = signal<CheckinStats | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  private timer?: ReturnType<typeof setInterval>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private es?: EventSource;
  private destroyed = false;

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;
    queueMicrotask(() => {
      this.load();
      this.openStream();
      this.timer = setInterval(() => this.load(), 25000); // fallback lento (SSE es el primario)
    });
  }

  /**
   * Abre el SSE del evento sin poner el token en la URL (CWE-317): pide un TICKET de un
   * solo uso (Bearer en header) y abre EventSource con `?ticket=`. En cada `checkin`
   * recarga las stats. Como el ticket se consume al abrir, la reconexión pide uno nuevo.
   */
  private openStream(): void {
    if (this.destroyed || typeof EventSource === 'undefined') return; // SSR/sin soporte → solo polling
    this.api.streamTicket(this.eventId()).subscribe({
      next: ({ ticket }) => this.connect(ticket),
      error: () => {
        /* sin ticket → el polling lento mantiene el dashboard; reintenta luego */
        this.scheduleReconnect();
      },
    });
  }

  private connect(ticket: string): void {
    if (this.destroyed) return;
    try {
      this.es = new EventSource(
        `${this.baseUrl}/events/${this.eventId()}/validators/checkin-stream?ticket=${encodeURIComponent(ticket)}`,
      );
      // El backend emite eventos con nombre `checkin` (y `ready` al abrir).
      this.es.addEventListener('checkin', () => this.load());
      this.es.onerror = () => {
        // El ticket es de un solo uso → EventSource no puede auto-reconectar con la misma
        // URL. Cerramos y pedimos un ticket nuevo (con retardo). El polling cubre el hueco.
        this.es?.close();
        this.es = undefined;
        this.scheduleReconnect();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.openStream();
    }, 5000);
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
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.es?.close();
  }
}
