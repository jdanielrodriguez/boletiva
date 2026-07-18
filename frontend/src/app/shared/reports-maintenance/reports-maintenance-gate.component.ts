import { Component, DestroyRef, afterNextRender, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { PublicConfigStore } from '../../core/config/public-config.store';
import { IconComponent } from '../icon/icon.component';

/**
 * Compuerta de MANTENIMIENTO DE REPORTES. Envuelve el contenido de un dashboard/reporte:
 *  - si `reports.maintenance` (admin) está activo → muestra un aviso embebido (el contenido
 *    proyectado NO se renderiza → no dispara sus consultas), sin romper la navegación por tabs;
 *  - si no → proyecta el dashboard normal (`<ng-content>`).
 *
 * REACTIVO: al montarse re-consulta `/public/config` (capta el cambio al entrar/actualizar) y
 * luego sondea cada 30 s (browser-only) para que un dashboard DEJADO ABIERTO entre en
 * mantenimiento en cuanto el admin active el flag, sin recargar. Se usa en los reportes de
 * EVENTO y de PROMOTOR (y en el futuro dashboard de chequeo de boletos de los validadores).
 */
@Component({
  selector: 'app-reports-maintenance-gate',
  imports: [TranslatePipe, IconComponent],
  template: `
    @if (config.reportsMaintenance()) {
      <div class="reports-maint" data-testid="reports-maintenance" role="status">
        <span class="rm-icon" aria-hidden="true"><app-icon name="maintenance" [size]="40" /></span>
        <h3>{{ 'reportsMaintenance.title' | translate }}</h3>
        <p>{{ 'reportsMaintenance.body' | translate }}</p>
      </div>
    } @else {
      <ng-content />
    }
  `,
  styles: [
    `
      .reports-maint {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 0.6rem;
        padding: 3rem 1.25rem;
        border: 1px dashed var(--pe-border, rgba(255, 255, 255, 0.15));
        border-radius: 14px;
        background: var(--pe-surface, rgba(255, 255, 255, 0.03));
      }
      .rm-icon {
        display: inline-flex;
        width: 72px;
        height: 72px;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        background: var(--pe-warning-soft, rgba(255, 181, 71, 0.16));
        color: var(--pe-warning, #ffb547);
      }
      .reports-maint h3 {
        margin: 0;
      }
      .reports-maint p {
        margin: 0;
        max-width: 34rem;
        color: var(--pe-muted, rgba(255, 255, 255, 0.6));
        line-height: 1.55;
      }
    `,
  ],
})
export class ReportsMaintenanceGateComponent {
  protected readonly config = inject(PublicConfigStore);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Browser-only: re-consulta al montar + sondeo cada 30 s (capta el flip en caliente).
    afterNextRender(() => {
      this.config.refresh();
      const id = setInterval(() => this.config.refresh(), 30_000);
      this.destroyRef.onDestroy(() => clearInterval(id));
    });
  }
}
