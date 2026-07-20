import { isPlatformBrowser } from '@angular/common';
import { HttpResponse } from '@angular/common/http';
import { Component, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AdminApi, AdminProfitabilityDto } from '../../core/api/admin.api';
import { ToastService } from '../../core/ui/toast.service';
import { BackLinkComponent } from '../../shared/ui/back-link.component';
import { LoadingComponent } from '../../shared/ui/loading.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { ChartComponent, ChartOptions } from '../../shared/ui/chart.component';
import { chartPalette } from '../../shared/ui/chart-palette';
import { MoneyPipe } from '../../shared/money.pipe';

/**
 * Fase 4 — Rentabilidad de la plataforma por evento (admin). Muestra KPIs globales
 * (recaudado, ganancia de plataforma, % efectivo, neto/IVA/pasarela) + gráfica de
 * ganancia por evento + tabla comparable con el **% de comisión aplicado por evento**.
 * Todo server-authoritative (el backend agrega el snapshot de órdenes); solo presenta.
 */
@Component({
  selector: 'app-profitability-page',
  standalone: true,
  imports: [
    TranslatePipe,
    BackLinkComponent,
    LoadingComponent,
    EmptyStateComponent,
    ChartComponent,
    MoneyPipe,
  ],
  templateUrl: './profitability.page.html',
  styleUrl: './profitability.page.css',
})
export class ProfitabilityPage {
  private readonly admin = inject(AdminApi);
  private readonly t = inject(TranslateService);
  private readonly toasts = inject(ToastService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);

  protected readonly data = signal<AdminProfitabilityDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly downloading = signal(false);

  constructor() {
    this.admin.profitability().subscribe({
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
  protected readonly isEmpty = computed(() => {
    const d = this.data();
    return !this.loading() && !this.error() && !!d && d.events.length === 0;
  });

  /** Barra horizontal de la GANANCIA de plataforma por evento (top 10). */
  protected readonly chartOptions = computed<ChartOptions>(() => {
    const rows = (this.data()?.events ?? []).slice(0, 10);
    return {
      chart: {
        type: 'bar',
        height: Math.max(200, rows.length * 42 + 60),
        toolbar: { show: false },
        fontFamily: 'inherit',
      },
      plotOptions: { bar: { horizontal: true, borderRadius: 4, distributed: true } },
      series: [{ name: this.t.instant('config.profit.platformProfit'), data: rows.map((r) => Number(r.platformFee)) }],
      xaxis: { categories: rows.map((r) => r.name) },
      colors: (() => { const p = chartPalette(); return [p.accent, p.accent2, p.success, p.warning]; })(),
      dataLabels: { enabled: false },
      legend: { show: false },
      grid: { borderColor: chartPalette().muted + '33' },
      noData: { text: this.t.instant('config.profit.noData') },
    };
  });

  /** Reusa las etiquetas del filtro de estado de eventos (config.events.status*). */
  protected statusLabel(s: string): string {
    const key = 'config.events.status' + s.charAt(0).toUpperCase() + s.slice(1);
    const label = this.t.instant(key);
    return label === key ? s : label;
  }

  protected downloadExcel(): void {
    if (!isPlatformBrowser(this.platformId) || this.downloading()) return;
    this.downloading.set(true);
    this.admin.exportProfitability().subscribe({
      next: (res) => {
        this.downloading.set(false);
        const blob = res.body;
        if (!blob) {
          this.toasts.error(this.t.instant('config.profit.exportError'));
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = this.document.createElement('a');
        a.href = url;
        a.download = this.filenameFrom(res) ?? 'rentabilidad-eventos.xlsx';
        this.document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      },
      error: () => {
        this.downloading.set(false);
        this.toasts.error(this.t.instant('config.profit.exportError'));
      },
    });
  }

  private filenameFrom(res: HttpResponse<Blob>): string | null {
    const cd = res.headers.get('content-disposition') ?? '';
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
    return match ? decodeURIComponent(match[1].trim()) : null;
  }
}
