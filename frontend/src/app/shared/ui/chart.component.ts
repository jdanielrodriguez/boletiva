import { Component, ElementRef, OnDestroy, afterNextRender, effect, input, viewChild } from '@angular/core';

/** Opciones de ApexCharts (tipado laxo: no importamos la lib en tiempo de módulo). */
export type ChartOptions = Record<string, unknown>;

interface ApexInstance {
  render(): Promise<void>;
  updateOptions(options: ChartOptions, redraw?: boolean, animate?: boolean): Promise<void>;
  destroy(): void;
}

/**
 * Envoltura de ApexCharts BROWSER-ONLY. ApexCharts toca el DOM (SVG/canvas) y no
 * existe en SSR, así que se carga por import dinámico tras el primer render, igual
 * que Konva/Leaflet en el resto del proyecto (`afterNextRender` + `await import`).
 * En SSR no se instancia (el div queda vacío y se hidrata en el navegador).
 */
@Component({
  selector: 'app-chart',
  standalone: true,
  template: `<div #host class="chart-host"></div>`,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
      .chart-host {
        width: 100%;
        min-height: 200px;
      }
    `,
  ],
})
export class ChartComponent implements OnDestroy {
  /** Opciones completas de ApexCharts (chart/series/xaxis/…). */
  readonly options = input.required<ChartOptions>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private chart: ApexInstance | null = null;
  private ready = false;

  constructor() {
    afterNextRender(async () => {
      try {
        const Apex = (await import('apexcharts')).default as unknown as new (
          el: HTMLElement,
          opts: ChartOptions,
        ) => ApexInstance;
        this.chart = new Apex(this.host().nativeElement, this.options());
        await this.chart.render();
        this.ready = true;
      } catch {
        // Entorno sin DOM completo o lib no disponible: no rompemos la vista.
        this.chart = null;
      }
    });

    // Cuando cambian las opciones (nuevos datos), re-dibuja sin recrear la gráfica.
    effect(() => {
      const opts = this.options();
      if (this.ready && this.chart) void this.chart.updateOptions(opts, true, true);
    });
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
    this.chart = null;
  }
}
