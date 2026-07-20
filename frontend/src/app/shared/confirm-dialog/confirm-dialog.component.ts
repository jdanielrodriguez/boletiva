import { ChangeDetectionStrategy, Component, Injector, inject, input, output } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TranslatePipe } from '@ngx-translate/core';
import { IconComponent, type IconName } from '../icon/icon.component';
import { AuditApi } from '../../core/api/audit.api';

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
  /** Etiqueta de auditoría (no-repudio): al confirmar registra el click. */
  auditAction?: string;
  /** Referencia del recurso afectado (acompaña a `auditAction`). */
  auditResource?: string;
  onConfirm: () => void;
  /** Callback opcional al CANCELAR (p.ej. resolver un guard de "descartar cambios"). */
  onCancel?: () => void;
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
        <button type="button" class="btn" [class.danger]="danger()" [class.primary]="!danger()" (click)="onAccept()" data-testid="confirm-accept" [title]="confirmLabel()">
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
        background: var(--pe-accent-soft);
        color: var(--pe-primary);
      }
      .confirm-icon.is-danger {
        background: var(--pe-danger-soft);
        color: var(--pe-danger);
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
  /**
   * Etiqueta de auditoría (no-repudio, v3.8 · G4). Si el llamador la provee, al
   * confirmar se registra un click en la bitácora (`POST /audit/confirm`). Si no
   * se pasa `auditAction`, NO se audita (los usos actuales del diálogo siguen
   * igual). `auditResource` acompaña con el id/referencia del recurso afectado.
   */
  readonly auditAction = input<string | undefined>(undefined);
  readonly auditResource = input<string | undefined>(undefined);
  readonly accept = output<void>();
  readonly cancelled = output<void>();

  private readonly injector = inject(Injector);
  // El diálogo es presentacional y algunos specs lo montan SIN HttpClient (APIs
  // stubbeadas). Solo auditamos si HttpClient está disponible (siempre en la app
  // real); si no, degradamos en silencio sin romper esos tests.
  private readonly canAudit = inject(HttpClient, { optional: true }) !== null;

  /** Icono efectivo: el explícito, o 'alert'/'help' según sea destructiva. */
  protected readonly resolvedTitleIcon = () => this.titleIcon() ?? (this.danger() ? 'alert' : 'help');

  /**
   * Confirma la acción. Antes de emitir, registra el click en la bitácora si hay
   * `auditAction`. FIRE-AND-FORGET: no espera al audit ni deja que su fallo bloquee
   * la acción del usuario (error capturado en silencio). La acción se emite SIEMPRE.
   */
  protected onAccept(): void {
    const action = this.auditAction();
    if (action && this.canAudit) {
      this.injector
        .get(AuditApi)
        .confirm(action, this.auditResource())
        .subscribe({ error: () => undefined });
    }
    this.accept.emit();
  }
}
