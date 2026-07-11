import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { IconComponent } from '../icon/icon.component';
import { MaintenanceApi } from '../../core/api/maintenance.api';
import { MaintenanceStore } from '../../core/maintenance/maintenance.store';
import { ToastService } from '../../core/ui/toast.service';

/**
 * Banner superior persistente que SOLO ve el admin cuando el mantenimiento está
 * activo (v3.8 · G4). Le recuerda que la plataforma está oculta para el resto y le
 * da el botón para desactivarlo (`PATCH /admin/maintenance {enabled:false}`). Al
 * desactivar actualiza el estado global → el banner desaparece sin recargar.
 */
@Component({
  selector: 'app-maintenance-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, TranslatePipe],
  template: `
    <div class="mnt-banner" role="alert" data-testid="maintenance-banner">
      <span class="mnt-banner-icon" aria-hidden="true"><app-icon name="maintenance" [size]="18" /></span>
      <span class="mnt-banner-text">{{ 'maintenance.bannerAdmin' | translate }}</span>
      <button
        type="button"
        class="btn sm"
        [disabled]="busy()"
        (click)="disable()"
        data-testid="maintenance-disable"
      >
        {{ (busy() ? 'common.sending' : 'maintenance.disable') | translate }}
      </button>
    </div>
  `,
  styles: [
    `
      .mnt-banner {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
        gap: 0.6rem 0.9rem;
        padding: 0.6rem 1rem;
        background: var(--pe-warning);
        color: var(--pe-warning-ink);
        font-weight: 600;
        text-align: center;
      }
      .mnt-banner-icon {
        display: inline-flex;
        align-items: center;
      }
      .mnt-banner .btn {
        background: var(--pe-warning-ink);
        color: var(--pe-warning);
        border-color: transparent;
      }
    `,
  ],
})
export class MaintenanceBannerComponent {
  private readonly api = inject(MaintenanceApi);
  private readonly store = inject(MaintenanceStore);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected readonly busy = signal(false);

  disable(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.api.disable().subscribe({
      next: () => {
        this.store.markDisabled();
        this.busy.set(false);
        this.toast.success(this.translate.instant('maintenance.disabled'));
      },
      error: () => {
        this.busy.set(false);
        this.toast.error(this.translate.instant('common.error'));
      },
    });
  }
}
