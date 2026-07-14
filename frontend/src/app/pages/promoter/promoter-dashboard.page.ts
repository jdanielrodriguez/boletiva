import { isPlatformBrowser } from '@angular/common';
import { HttpResponse } from '@angular/common/http';
import { Component, computed, inject, PLATFORM_ID, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PromoterDashboardApi } from '../../core/api/promoter-dashboard.api';
import { SessionStore } from '../../core/auth/session.store';
import { ToastService } from '../../core/ui/toast.service';
import { BackLinkComponent } from '../../shared/ui/back-link.component';
import { LoadingComponent } from '../../shared/ui/loading.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { ChartComponent, ChartOptions } from '../../shared/ui/chart.component';
import { MoneyPipe } from '../../shared/money.pipe';
import type { PromoterDashboardDto, PromoterDimensionRowDto } from '../../core/api/types';

const PALETTE = {
  accent: '#c026d3',
  accent2: '#7c3aed',
  success: '#16a34a',
  warning: '#d97706',
};

type DimKey = 'event' | 'category' | 'hall' | 'status' | 'month';
const DIMENSIONS: DimKey[] = ['event', 'category', 'hall', 'status', 'month'];

/** Estado de evento → clave i18n (la dimensión `status` usa la clave cruda del backend). */
const STATUS_KEY: Record<string, string> = {
  draft: 'promoter.dash.st.draft',
  published: 'promoter.dash.st.published',
  suspended: 'promoter.dash.st.suspended',
  cancelled: 'promoter.dash.st.cancelled',
  finished: 'promoter.dash.st.finished',
};

/**
 * Dashboard GLOBAL del promotor (Fase 3): KPIs de rentabilidad sobre TODOS sus
 * eventos + ventas/día + tabla cruzada por dimensión (evento/categoría/salón/estado/
 * mes) + export a Excel. Todos los montos vienen agregados y redondeados del backend
 * (server-authoritative); esta vista SOLO los presenta — cero aritmética de dinero.
 * El admin puede inspeccionar a un promotor concreto vía la sesión de impersonación.
 */
@Component({
  selector: 'app-promoter-dashboard-page',
  standalone: true,
  imports: [
    TranslatePipe,
    BackLinkComponent,
    LoadingComponent,
    EmptyStateComponent,
    ChartComponent,
    MoneyPipe,
  ],
  templateUrl: './promoter-dashboard.page.html',
  styleUrl: './promoter-dashboard.page.css',
})
export class PromoterDashboardPage {
  private readonly api = inject(PromoterDashboardApi);
  private readonly t = inject(TranslateService);
  private readonly session = inject(SessionStore);
  private readonly toasts = inject(ToastService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);

  protected readonly data = signal<PromoterDashboardDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly downloading = signal(false);
  protected readonly selectedDim = signal<DimKey>('event');
  protected readonly dimensions = DIMENSIONS;

  constructor() {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(false);
    this.api.dashboard().subscribe({
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

  protected readonly currency = computed(() => this.data()?.currency ?? 'GTQ');

  /** Es admin real (no impersonando): ve el desglose interno de servicios/IVA. */
  protected readonly isAdmin = computed(() => this.session.hasRole('admin'));

  /**
   * Sin ventas aún: NO oculta el dashboard, lo muestra en cero (vista previa) con un
   * aviso, para que se vea cómo lucirá cuando sus eventos vendan.
   */
  protected readonly isEmpty = computed(() => {
    const d = this.data();
    return !this.loading() && !this.error() && !!d && d.summary.paidOrders === 0;
  });

  /** Filas de la dimensión seleccionada, con la etiqueta de estado ya traducida. */
  protected readonly rows = computed<PromoterDimensionRowDto[]>(() => {
    const d = this.data();
    if (!d) return [];
    const dim = this.selectedDim();
    const rows = d.dimensions[dim] ?? [];
    if (dim !== 'status') return rows;
    return rows.map((r) => ({ ...r, label: this.t.instant(STATUS_KEY[r.label] ?? r.label) }));
  });

  protected selectDim(dim: DimKey): void {
    this.selectedDim.set(dim);
  }

  protected dimLabel(dim: DimKey): string {
    return this.t.instant(`promoter.dash.dim.${dim}`);
  }

  private noData(): { text: string } {
    return { text: this.t.instant('promoter.dash.noData') };
  }

  protected readonly salesOptions = computed<ChartOptions>(() => {
    const pts = this.data()?.salesOverTime ?? [];
    return {
      chart: { type: 'area', height: 280, toolbar: { show: false }, fontFamily: 'inherit' },
      series: [{ name: this.t.instant('promoter.dash.revenue'), data: pts.map((p) => Number(p.revenue)) }],
      xaxis: { categories: pts.map((p) => p.day) },
      yaxis: { labels: { formatter: (v: number) => v.toFixed(0) } },
      colors: [PALETTE.accent],
      stroke: { width: 2, curve: 'smooth' },
      fill: { type: 'gradient', opacity: 0.35 },
      dataLabels: { enabled: false },
      grid: { borderColor: 'rgba(148,163,184,0.2)' },
      noData: this.noData(),
    };
  });

  /** Barra horizontal del NETO por grupo de la dimensión seleccionada. */
  protected readonly dimChartOptions = computed<ChartOptions>(() => {
    const rows = this.rows().slice(0, 10);
    return {
      chart: {
        type: 'bar',
        height: Math.max(200, rows.length * 42 + 60),
        toolbar: { show: false },
        fontFamily: 'inherit',
      },
      plotOptions: { bar: { horizontal: true, borderRadius: 4, distributed: true } },
      series: [{ name: this.t.instant('promoter.dash.net'), data: rows.map((r) => Number(r.net)) }],
      xaxis: { categories: rows.map((r) => r.label) },
      colors: [PALETTE.accent, PALETTE.accent2, PALETTE.success, PALETTE.warning],
      dataLabels: { enabled: false },
      legend: { show: false },
      grid: { borderColor: 'rgba(148,163,184,0.2)' },
      noData: this.noData(),
    };
  });

  /**
   * Descarga el dashboard en Excel (.xlsx). Binario con auth (Bearer, pasa por el
   * interceptor); crea un objectURL y dispara `<a download>`. Solo navegador.
   */
  protected downloadExcel(): void {
    if (!isPlatformBrowser(this.platformId) || this.downloading()) return;
    this.downloading.set(true);
    this.api.export().subscribe({
      next: (res) => {
        this.downloading.set(false);
        const blob = res.body;
        if (!blob) {
          this.toasts.error(this.t.instant('promoter.dash.exportError'));
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = this.document.createElement('a');
        a.href = url;
        a.download = this.filenameFrom(res) ?? 'dashboard.xlsx';
        this.document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      },
      error: () => {
        this.downloading.set(false);
        this.toasts.error(this.t.instant('promoter.dash.exportError'));
      },
    });
  }

  private filenameFrom(res: HttpResponse<Blob>): string | null {
    const cd = res.headers.get('content-disposition') ?? '';
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
    return match ? decodeURIComponent(match[1].trim()) : null;
  }
}
