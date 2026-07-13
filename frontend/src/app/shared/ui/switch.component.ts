import { ChangeDetectionStrategy, Component, booleanAttribute, input, output } from '@angular/core';

/**
 * Interruptor (toggle) accesible ESTANDARIZADO (v3.10 · GI). Reemplaza a los
 * `<input type="checkbox">` en TODO dato booleano (2 valores): settings del admin,
 * modo pruebas, invitar, etc. Regla del proyecto: switch para cualquier dato con
 * solo 2 valores.
 *
 * - `role="switch"` + `aria-checked` → lector de pantalla lo anuncia como toggle.
 * - Es un `<button>` → teclado (Enter/Espacio) y foco gratis; `disabled` nativo.
 * - Presentacional puro (OnPush): `[checked]` de entrada + `(checkedChange)` de
 *   salida (patrón banana-in-a-box compatible, sin ControlValueAccessor).
 * - Estilizado con tokens `--pe-*` (activo = acento del proyecto).
 */
@Component({
  selector: 'app-switch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      role="switch"
      class="pe-switch"
      [class.on]="checked()"
      [attr.aria-checked]="checked()"
      [attr.aria-label]="ariaLabel() || label() || null"
      [disabled]="disabled()"
      [attr.data-testid]="testId() || null"
      (click)="toggle()"
    >
      <span class="pe-switch-track"><span class="pe-switch-thumb"></span></span>
      @if (label()) {
        <span class="pe-switch-label">{{ label() }}</span>
      }
    </button>
  `,
  styles: [
    `
      .pe-switch {
        display: inline-flex;
        align-items: center;
        gap: 0.55rem;
        background: transparent;
        border: none;
        padding: 0.15rem 0;
        cursor: pointer;
        color: var(--pe-text);
        font: inherit;
        line-height: 1.2;
      }
      .pe-switch:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }
      .pe-switch-track {
        position: relative;
        flex: 0 0 auto;
        width: 42px;
        height: 24px;
        border-radius: 999px;
        background: var(--pe-surface-2);
        border: 1px solid var(--pe-border);
        transition: background 0.18s ease, border-color 0.18s ease;
      }
      .pe-switch-thumb {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: var(--pe-muted);
        transition: transform 0.18s ease, background 0.18s ease;
      }
      .pe-switch.on .pe-switch-track {
        background: var(--pe-accent-soft);
        border-color: var(--pe-accent-border, var(--pe-accent));
      }
      .pe-switch.on .pe-switch-thumb {
        transform: translateX(18px);
        background: var(--pe-accent);
      }
      .pe-switch:focus-visible {
        outline: none;
      }
      .pe-switch:focus-visible .pe-switch-track {
        box-shadow: 0 0 0 3px var(--pe-accent-soft);
        border-color: var(--pe-accent);
      }
      .pe-switch-label {
        font-size: 0.9rem;
      }
    `,
  ],
})
export class SwitchComponent {
  /** Estado actual (true = encendido). */
  readonly checked = input(false, { transform: booleanAttribute });
  /** Etiqueta opcional a la derecha del toggle. */
  readonly label = input('');
  /** Desactiva la interacción (estado de solo lectura). */
  readonly disabled = input(false, { transform: booleanAttribute });
  /** aria-label (si no hay label visible). */
  readonly ariaLabel = input('');
  /** data-testid opcional (se propaga al botón). */
  readonly testId = input('');

  /** Emite el nuevo valor al alternar. */
  readonly checkedChange = output<boolean>();

  protected toggle(): void {
    if (this.disabled()) return;
    this.checkedChange.emit(!this.checked());
  }
}
