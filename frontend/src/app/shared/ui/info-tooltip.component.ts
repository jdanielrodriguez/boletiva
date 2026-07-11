import { ChangeDetectionStrategy, Component, HostListener, ElementRef, inject, input, signal } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

/**
 * Botón de información (i) con TOOLTIP/popover bonito y accesible (v3.8 · G2). Se
 * abre con click o teclado (Enter/Espacio), se cierra con click fuera o Escape.
 * Presentacional: los textos llegan YA traducidos del padre. Usa tokens `--pe-*`
 * para integrarse con el tema (claro/oscuro) y es responsive (el popover se ancla
 * arriba-derecha y limita su ancho). El contenido admite un título, un
 * tipo/valores opcionales y un detalle libre.
 */
@Component({
  selector: 'app-info-tooltip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <span class="info-wrap">
      <button
        type="button"
        class="info-btn"
        [class.open]="open()"
        (click)="toggle($event)"
        [attr.aria-expanded]="open()"
        [attr.aria-label]="ariaLabel()"
        data-testid="info-tooltip-btn"
      >
        <app-icon name="help" [size]="15" />
      </button>
      @if (open()) {
        <span class="info-pop" role="tooltip" data-testid="info-tooltip-pop">
          @if (heading()) {
            <strong class="info-pop-title">{{ heading() }}</strong>
          }
          <span class="info-pop-body">{{ detail() }}</span>
          @if (meta()) {
            <span class="info-pop-meta">{{ meta() }}</span>
          }
        </span>
      }
    </span>
  `,
  styles: [
    `
      .info-wrap {
        position: relative;
        display: inline-flex;
      }
      .info-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        padding: 0;
        border-radius: 50%;
        border: 1px solid var(--pe-border);
        background: var(--pe-surface-2, transparent);
        color: var(--pe-accent, #e14eca);
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease;
      }
      .info-btn:hover,
      .info-btn.open {
        background: var(--pe-accent-soft, rgba(225, 78, 202, 0.14));
        border-color: var(--pe-accent, #e14eca);
      }
      .info-pop {
        position: absolute;
        z-index: 40;
        top: calc(100% + 8px);
        right: 0;
        width: max-content;
        max-width: min(20rem, 78vw);
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        padding: 0.7rem 0.85rem;
        border-radius: var(--pe-radius, 12px);
        background: var(--pe-surface, #1b1b28);
        border: 1px solid var(--pe-border);
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.28);
        text-align: left;
        white-space: normal;
      }
      .info-pop-title {
        font-size: 0.9rem;
        color: var(--pe-text, inherit);
      }
      .info-pop-body {
        font-size: 0.85rem;
        line-height: 1.4;
        color: var(--pe-text, inherit);
        opacity: 0.9;
      }
      .info-pop-meta {
        font-size: 0.78rem;
        color: var(--pe-accent, #e14eca);
        font-weight: 600;
      }
    `,
  ],
})
export class InfoTooltipComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

  /** Título del popover (opcional). */
  readonly heading = input<string>('');
  /** Cuerpo/detalle principal (qué hace). */
  readonly detail = input.required<string>();
  /** Línea de metadatos (tipo · valores posibles), opcional. */
  readonly meta = input<string>('');
  /** aria-label del botón (ya traducido). */
  readonly ariaLabel = input<string>('Más información');

  protected readonly open = signal(false);

  protected toggle(event: MouseEvent): void {
    event.stopPropagation();
    this.open.update((v) => !v);
  }

  @HostListener('document:click', ['$event'])
  onDocClick(event: MouseEvent): void {
    if (!this.open()) return;
    if (!this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) this.open.set(false);
  }
}
