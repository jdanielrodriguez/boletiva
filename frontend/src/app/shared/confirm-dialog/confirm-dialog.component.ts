import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { IconComponent, type IconName } from '../icon/icon.component';

/** Petición de confirmación: el disparador guarda esto y ejecuta `onConfirm` al aceptar. */
export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  confirmIcon?: IconName;
  /** Icono grande del encabezado (default 'alert' para acciones destructivas). */
  titleIcon?: IconName;
  /** false = acción NO destructiva (encabezado neutro y botón primario). */
  danger?: boolean;
  onConfirm: () => void;
}

/**
 * Modal de confirmación REUTILIZABLE (mismo estilo que el modal de "Suspender a
 * Promotor"): ninguna acción destructiva se ejecuta al primer click. El padre lo
 * renderiza con `@if` y provee título/mensaje; `accept`/`cancel` cierran el flujo.
 */
@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, TranslatePipe],
  template: `<div class="modal-backdrop" data-testid="confirm-dialog">
    <div class="modal-card confirm-card" role="alertdialog" aria-modal="true" [attr.aria-labelledby]="'confirm-title'" [attr.aria-describedby]="'confirm-msg'">
      <div class="confirm-head" [class.is-danger]="danger()">
        <span class="confirm-icon" [class.is-danger]="danger()" aria-hidden="true">
          <app-icon [name]="resolvedTitleIcon()" [size]="28" />
        </span>
        <h3 id="confirm-title" class="confirm-title">{{ title() }}</h3>
      </div>
      <p id="confirm-msg" class="confirm-message">{{ message() }}</p>
      <div class="ev-card-actions confirm-actions">
        <button type="button" class="btn" [class.danger]="danger()" [class.primary]="!danger()" (click)="accept.emit()" data-testid="confirm-accept" [title]="confirmLabel()">
          <app-icon [name]="confirmIcon()" /> {{ confirmLabel() }}
        </button>
        <button type="button" class="btn" (click)="cancelled.emit()" data-testid="confirm-cancel" [title]="'common.cancel' | translate">
          <app-icon name="cancel" /> {{ 'common.cancel' | translate }}
        </button>
      </div>
    </div>
  </div>`,
  styles: [
    `
      .confirm-head {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.6rem;
        text-align: center;
      }
      .confirm-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: rgba(123, 92, 255, 0.14);
        color: var(--pe-primary, #7b5cff);
      }
      .confirm-icon.is-danger {
        background: rgba(239, 68, 68, 0.16);
        color: #ef4444;
      }
      .confirm-title {
        margin: 0;
        font-size: 1.35rem;
        font-weight: 700;
        text-align: center;
      }
      .confirm-message {
        margin: 0.9rem 0 1.4rem;
        text-align: center;
        font-size: 1.02rem;
        line-height: 1.5;
        color: var(--pe-text, inherit);
        opacity: 0.92;
      }
      .confirm-actions {
        justify-content: center;
      }
      .confirm-actions .btn {
        min-width: 130px;
        justify-content: center;
      }
    `,
  ],
})
export class ConfirmDialogComponent {
  readonly title = input('¿Confirmar acción?');
  readonly message = input('Esta acción no se puede deshacer.');
  readonly confirmLabel = input('Eliminar');
  readonly confirmIcon = input<IconName>('delete');
  /** ¿Acción destructiva? (default sí → encabezado de alerta rojo). */
  readonly danger = input(true);
  /** Icono del encabezado; default sensato según sea destructiva o no. */
  readonly titleIcon = input<IconName | undefined>(undefined);
  readonly accept = output<void>();
  readonly cancelled = output<void>();

  /** Icono efectivo: el explícito, o 'alert'/'help' según sea destructiva. */
  protected readonly resolvedTitleIcon = () => this.titleIcon() ?? (this.danger() ? 'alert' : 'help');
}
