import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { IconComponent } from '../icon/icon.component';

/**
 * Página de mantenimiento a pantalla completa (v3.8 · G4). Se muestra a los
 * usuarios NO-admin (o anónimos) mientras la plataforma está en mantenimiento y
 * BLOQUEA el uso. Presentacional puro: el `App` decide cuándo montarla. Muestra el
 * `message` del backend si viene; si no, un texto por defecto traducido.
 */
@Component({
  selector: 'app-maintenance-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, TranslatePipe],
  template: `
    <div class="mnt-page" role="alertdialog" aria-modal="true" data-testid="maintenance-page">
      <div class="mnt-card">
        <span class="mnt-icon" aria-hidden="true">
          <app-icon name="maintenance" [size]="40" />
        </span>
        <h1 class="mnt-title">{{ 'maintenance.title' | translate }}</h1>
        @if (message()) {
          <p class="mnt-message" data-testid="maintenance-message">{{ message() }}</p>
        } @else {
          <p class="mnt-message">{{ 'maintenance.body' | translate }}</p>
        }
        <p class="mnt-hint muted">{{ 'maintenance.hint' | translate }}</p>
      </div>
    </div>
  `,
  styles: [
    `
      .mnt-page {
        position: fixed;
        inset: 0;
        z-index: 1100;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
        background: var(--pe-bg);
        background-image: radial-gradient(900px 460px at 80% -10%, rgba(123, 92, 255, 0.16), transparent 70%),
          radial-gradient(760px 420px at -10% 0%, rgba(225, 78, 202, 0.12), transparent 70%);
      }
      .mnt-card {
        max-width: 30rem;
        width: 100%;
        text-align: center;
        background: var(--pe-surface);
        border: 1px solid var(--pe-border);
        border-radius: 18px;
        padding: 2.5rem 2rem;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4);
      }
      .mnt-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 84px;
        height: 84px;
        border-radius: 50%;
        margin-bottom: 1.2rem;
        background: var(--pe-warning-soft);
        color: var(--pe-warning);
      }
      .mnt-title {
        margin: 0 0 0.75rem;
        font-size: 1.6rem;
        font-weight: 800;
        color: var(--pe-text);
      }
      .mnt-message {
        margin: 0 0 0.9rem;
        font-size: 1.05rem;
        line-height: 1.55;
        color: var(--pe-text);
        opacity: 0.92;
      }
      .mnt-hint {
        margin: 0;
        font-size: 0.9rem;
      }
      @media (max-width: 480px) {
        .mnt-card {
          padding: 2rem 1.25rem;
        }
        .mnt-title {
          font-size: 1.35rem;
        }
      }
    `,
  ],
})
export class MaintenancePageComponent {
  /** Mensaje del backend; si es null se usa el texto por defecto traducido. */
  readonly message = input<string | null>(null);
}
