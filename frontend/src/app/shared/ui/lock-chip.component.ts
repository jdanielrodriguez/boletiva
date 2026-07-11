import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

/**
 * Candado de acción sensible ESTANDARIZADO (v3.9 · A2). Un solo control para todos
 * los "desbloquear por tiempo/código" del sistema (agregar pasarela en la consola
 * admin y editar un evento ajeno como admin), para que se vean y comporten IGUAL:
 * - CERRADO: botón icon-only con el candado (`.lock-btn.icon-only`, mismo estilo
 *   que el de pasarelas) → al pulsar emite `(unlock)` para abrir el modal del padre.
 * - ABIERTO: pastilla con el candado abierto y, opcional, la cuenta regresiva
 *   (mm:ss) ya formateada por el padre (`countdown`).
 *
 * Presentacional puro (OnPush): NO conoce el flujo de OTP ni el token; el padre
 * decide cuándo está abierto/cerrado y qué texto de cuenta regresiva mostrar. Los
 * `data-testid` se pasan por input para conservar los specs existentes.
 */
@Component({
  selector: 'app-lock-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @if (open()) {
      <span class="lock-chip lock-chip-open" [attr.data-testid]="openTestid()" [title]="openTitle()">
        <app-icon name="unlock" />
        @if (countdown()) {
          <span class="lock-countdown">{{ countdown() }}</span>
        }
      </span>
    } @else {
      <button
        type="button"
        class="btn icon-only lock-btn"
        (click)="unlock.emit()"
        [attr.data-testid]="closedTestid()"
        [title]="closedTitle()"
        [attr.aria-label]="closedTitle()"
      >
        <app-icon name="lock" />
      </button>
    }
  `,
})
export class LockChipComponent {
  /** true = desbloqueado (candado abierto + cuenta regresiva); false = cerrado. */
  readonly open = input(false);
  /** Texto de cuenta regresiva YA formateado (mm:ss con etiqueta), o vacío. */
  readonly countdown = input<string>('');
  /** data-testid del botón cerrado (para specs). */
  readonly closedTestid = input<string>('lock-btn');
  /** data-testid de la pastilla abierta (para specs). */
  readonly openTestid = input<string>('lock-timer');
  /** Título/aria del candado cerrado (ya traducido). */
  readonly closedTitle = input<string>('');
  /** Título de la pastilla abierta (ya traducido). */
  readonly openTitle = input<string>('');
  /** Se emite al pulsar el candado cerrado (el padre abre su modal). */
  readonly unlock = output<void>();
}
