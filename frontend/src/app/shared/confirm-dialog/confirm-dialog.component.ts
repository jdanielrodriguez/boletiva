import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent, type IconName } from '../icon/icon.component';

/** Petición de confirmación: el disparador guarda esto y ejecuta `onConfirm` al aceptar. */
export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  confirmIcon?: IconName;
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
  imports: [IconComponent],
  template: `<div class="modal-backdrop" data-testid="confirm-dialog">
    <div class="modal-card">
      <h3>{{ title() }}</h3>
      <p class="muted">{{ message() }}</p>
      <div class="ev-card-actions">
        <button type="button" class="btn danger" (click)="accept.emit()" data-testid="confirm-accept" [title]="confirmLabel()">
          <app-icon [name]="confirmIcon()" /> {{ confirmLabel() }}
        </button>
        <button type="button" class="btn" (click)="cancelled.emit()" data-testid="confirm-cancel" title="Cancelar">
          <app-icon name="cancel" /> Cancelar
        </button>
      </div>
    </div>
  </div>`,
})
export class ConfirmDialogComponent {
  readonly title = input('¿Confirmar acción?');
  readonly message = input('Esta acción no se puede deshacer.');
  readonly confirmLabel = input('Eliminar');
  readonly confirmIcon = input<IconName>('delete');
  readonly accept = output<void>();
  readonly cancelled = output<void>();
}
