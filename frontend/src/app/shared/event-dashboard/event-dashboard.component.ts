import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { LoadingComponent } from '../ui/loading.component';
import { EmptyStateComponent } from '../ui/empty-state.component';
import { ChartComponent, ChartOptions } from '../ui/chart.component';
import { MoneyPipe } from '../money.pipe';
import type { EventDashboardDto } from '../../core/api/types';

/** Paleta coherente con los tokens --pe-* (accent rosa-morado + estados). */
const PALETTE = {
  accent: '#c026d3',
  accent2: '#7c3aed',
  success: '#16a34a',
  warning: '#d97706',
  danger: '#e11d48',
  muted: '#94a3b8',
};

/**
 * Dashboard analítico de un evento: KPIs (recaudado/neto/ocupación/check-in) +
 * gráficas (ventas por día, ocupación por localidad, asistencia). Solo presentación
 * sobre `GET /events/:id/dashboard` (server-authoritative). Las gráficas usan
 * ApexCharts browser-only vía `app-chart`.
 */
@Component({
  selector: 'app-event-dashboard',
  standalone: true,
  imports: [TranslatePipe, LoadingComponent, EmptyStateComponent, ChartComponent, MoneyPipe],
  templateUrl: './event-dashboard.component.html',
  styles: [
    `
      .dash {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .dash-preview-note {
        margin: 0;
        padding: 0.6rem 0.9rem;
        border: 1px dashed var(--pe-accent, #c026d3);
        border-radius: 10px;
        background: var(--pe-accent-soft, rgba(192, 38, 211, 0.08));
        color: var(--pe-accent, #c026d3);
        font-size: 0.9rem;
      }
      .dash-kpis {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 0.75rem;
      }
      .kpi {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        padding: 0.85rem 1rem;
        border: 1px solid var(--pe-border, rgba(148, 163, 184, 0.25));
        border-radius: 12px;
        background: var(--pe-surface, rgba(148, 163, 184, 0.06));
      }
      .kpi-label {
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        opacity: 0.7;
      }
      .kpi-value {
        font-size: 1.25rem;
        font-weight: 700;
      }
      .kpi-value.accent {
        color: var(--pe-accent, #c026d3);
      }
      .dash-card {
        border: 1px solid var(--pe-border, rgba(148, 163, 184, 0.25));
        border-radius: 12px;
        padding: 1rem 1.1rem;
      }
      .dash-card h3 {
        margin: 0 0 0.5rem;
        font-size: 1rem;
      }
      .dash-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1rem;
      }
      .dash-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 0.75rem;
        font-size: 0.9rem;
      }
      .dash-table th,
      .dash-table td {
        padding: 0.4rem 0.5rem;
        border-bottom: 1px solid var(--pe-border, rgba(148, 163, 184, 0.2));
        text-align: left;
      }
      .dash-table .num {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .dash-table tfoot td {
        font-weight: 700;
        border-top: 2px solid var(--pe-border, rgba(148, 163, 184, 0.35));
      }
      .dash-att {
        list-style: none;
        margin: 0.75rem 0 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 0.4rem;
      }
      .dash-att li {
        display: flex;
        justify-content: space-between;
        padding: 0.3rem 0.5rem;
        border-radius: 8px;
        background: var(--pe-surface, rgba(148, 163, 184, 0.06));
        font-size: 0.9rem;
      }
    `,
  ],
})
export class EventDashboardComponent {
  private readonly api = inject(PromoterEventsApi);
  private readonly t = inject(TranslateService);

  /** Id del evento. */
  readonly eventId = input.required<string>();
  /** true = vista admin (muestra desglose de servicios/IVA además del neto). */
  readonly showSplit = input(false);
  /** Cambiar su valor fuerza re-fetch (p.ej. tras devoluciones). */
  readonly reloadToken = input(0);

  protected readonly data = signal<EventDashboardDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  constructor() {
    effect(() => {
      const id = this.eventId();
      this.reloadToken(); // dependencia para recargar
      if (!id) return;
      this.loading.set(true);
      this.error.set(false);
      this.api.dashboard(id).subscribe({
        next: (d) => {
          this.data.set(d);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(true);
          this.loading.set(false);
        },
      });
    });
  }

  protected readonly currency = computed(() => this.data()?.currency ?? 'GTQ');

  /** Servicios = todo lo que NO va al promotor (gross − net). Igual que en cuentas. */
  protected readonly services = computed(() => {
    const d = this.data()?.summary;
    if (!d) return '0.00';
    return (Number(d.gross) - Number(d.net)).toFixed(2);
  });

  /**
   * Sin órdenes pagadas → aún NO hay ventas. NO oculta el dashboard: se muestra en
   * cero (vista previa) con un aviso, para que el promotor vea cómo se verá.
   */
  protected readonly isEmpty = computed(() => {
    const d = this.data();
    return !this.loading() && !this.error() && !!d && d.summary.paidOrders === 0;
  });

  /** Texto de las gráficas cuando no hay datos (preview vacío amable). */
  private noData(): { text: string } {
    return { text: this.t.instant('promoter.dash.noData') };
  }

  // ---- Opciones de las gráficas (ApexCharts) ----

  /** Ventas por día: área del recaudado + línea de nº de órdenes. */
  protected readonly salesOptions = computed<ChartOptions>(() => {
    const pts = this.data()?.salesOverTime ?? [];
    return {
      chart: { type: 'area', height: 260, toolbar: { show: false }, fontFamily: 'inherit' },
      series: [
        { name: this.t.instant('promoter.dash.revenue'), type: 'area', data: pts.map((p) => Number(p.revenue)) },
        { name: this.t.instant('promoter.dash.orders'), type: 'line', data: pts.map((p) => p.orders) },
      ],
      xaxis: { categories: pts.map((p) => p.day) },
      yaxis: [
        { title: { text: this.currency() }, labels: { formatter: (v: number) => v.toFixed(0) } },
        { opposite: true, title: { text: this.t.instant('promoter.dash.orders') }, labels: { formatter: (v: number) => v.toFixed(0) } },
      ],
      colors: [PALETTE.accent, PALETTE.accent2],
      stroke: { width: [2, 3], curve: 'smooth' },
      fill: { type: ['gradient', 'solid'], opacity: [0.35, 1] },
      dataLabels: { enabled: false },
      legend: { position: 'top' },
      grid: { borderColor: 'rgba(148,163,184,0.2)' },
      noData: this.noData(),
    };
  });

  /** Ocupación por localidad: barras del % vendido. */
  protected readonly occupancyOptions = computed<ChartOptions>(() => {
    const locs = this.data()?.occupancy.byLocality ?? [];
    return {
      chart: { type: 'bar', height: Math.max(180, locs.length * 48 + 60), toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: { bar: { horizontal: true, borderRadius: 4, distributed: true } },
      series: [{ name: this.t.instant('promoter.dash.occupancy'), data: locs.map((l) => l.occupancyPct) }],
      xaxis: { categories: locs.map((l) => l.name), max: 100 },
      colors: [PALETTE.accent, PALETTE.accent2, PALETTE.success, PALETTE.warning],
      dataLabels: { enabled: true, formatter: (v: number) => `${v}%` },
      legend: { show: false },
      grid: { borderColor: 'rgba(148,163,184,0.2)' },
      noData: this.noData(),
    };
  });

  /** Asistencia: dona de estados de boletos. */
  protected readonly attendanceOptions = computed<ChartOptions>(() => {
    const a = this.data()?.attendance;
    return {
      chart: { type: 'donut', height: 260, fontFamily: 'inherit' },
      series: [a?.valid ?? 0, a?.used ?? 0, a?.transferred ?? 0, a?.revoked ?? 0],
      labels: [
        this.t.instant('promoter.dash.valid'),
        this.t.instant('promoter.dash.used'),
        this.t.instant('promoter.dash.transferred'),
        this.t.instant('promoter.dash.revoked'),
      ],
      colors: [PALETTE.accent2, PALETTE.success, PALETTE.warning, PALETTE.danger],
      legend: { position: 'bottom' },
      dataLabels: { enabled: true },
      noData: this.noData(),
    };
  });
}
