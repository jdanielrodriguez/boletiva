import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { HallsApi } from '../../core/api/halls.api';
import { SeatTemplatesApi } from '../../core/api/seat-templates.api';
import { LoadingComponent } from '../ui/loading.component';
import { EmptyStateComponent } from '../ui/empty-state.component';
import { ChartComponent, ChartOptions } from '../ui/chart.component';
import { MoneyPipe } from '../money.pipe';
import type { ScopeDashboardDto } from '../../core/api/types';

const PALETTE = {
  accent: '#c026d3',
  accent2: '#7c3aed',
  success: '#16a34a',
  warning: '#d97706',
};

/**
 * Dashboard de un ALCANCE (salón o plantilla): mismas métricas y estilo que el
 * dashboard de evento, agregadas sobre todos los eventos del alcance. Self-contained:
 * elige la API por `kind`. Presentación sobre datos server-authoritative.
 */
@Component({
  selector: 'app-scope-dashboard',
  standalone: true,
  imports: [TranslatePipe, LoadingComponent, EmptyStateComponent, ChartComponent, MoneyPipe],
  templateUrl: './scope-dashboard.component.html',
  styles: [
    `
      .dash {
        display: flex;
        flex-direction: column;
        gap: 1rem;
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
    `,
  ],
})
export class ScopeDashboardComponent {
  private readonly halls = inject(HallsApi);
  private readonly templates = inject(SeatTemplatesApi);
  private readonly t = inject(TranslateService);

  /** 'hall' | 'template'. */
  readonly kind = input.required<'hall' | 'template'>();
  readonly id = input.required<string>();

  protected readonly data = signal<ScopeDashboardDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  constructor() {
    effect(() => {
      const id = this.id();
      const kind = this.kind();
      if (!id) return;
      this.loading.set(true);
      this.error.set(false);
      const src = kind === 'hall' ? this.halls.dashboard(id) : this.templates.dashboard(id);
      src.subscribe({
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

  /** Sin eventos vinculados o sin ventas → estado vacío. */
  protected readonly isEmpty = computed(() => {
    const d = this.data();
    return !this.loading() && !this.error() && !!d && d.summary.paidOrders === 0;
  });
  protected readonly hasData = computed(() => {
    const d = this.data();
    return !this.loading() && !this.error() && !!d && d.summary.paidOrders > 0;
  });

  protected readonly salesOptions = computed<ChartOptions>(() => {
    const pts = this.data()?.salesOverTime ?? [];
    return {
      chart: { type: 'area', height: 260, toolbar: { show: false }, fontFamily: 'inherit' },
      series: [{ name: this.t.instant('config.dash.revenue'), data: pts.map((p) => Number(p.revenue)) }],
      xaxis: { categories: pts.map((p) => p.day) },
      yaxis: { labels: { formatter: (v: number) => v.toFixed(0) } },
      colors: [PALETTE.accent],
      stroke: { width: 2, curve: 'smooth' },
      fill: { type: 'gradient', opacity: 0.35 },
      dataLabels: { enabled: false },
      grid: { borderColor: 'rgba(148,163,184,0.2)' },
    };
  });

  protected readonly topEventsOptions = computed<ChartOptions>(() => {
    const top = this.data()?.topEvents ?? [];
    return {
      chart: { type: 'bar', height: Math.max(180, top.length * 46 + 60), toolbar: { show: false }, fontFamily: 'inherit' },
      plotOptions: { bar: { horizontal: true, borderRadius: 4, distributed: true } },
      series: [{ name: this.t.instant('config.dash.revenue'), data: top.map((e) => Number(e.gross)) }],
      xaxis: { categories: top.map((e) => e.name) },
      colors: [PALETTE.accent, PALETTE.accent2, PALETTE.success, PALETTE.warning],
      dataLabels: { enabled: false },
      legend: { show: false },
      grid: { borderColor: 'rgba(148,163,184,0.2)' },
    };
  });
}
