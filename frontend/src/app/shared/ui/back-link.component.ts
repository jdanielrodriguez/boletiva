import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Params, RouterLink } from '@angular/router';

/**
 * Enlace "volver" ESTANDARIZADO (v3.8 · G1): una flecha ← y una etiqueta, en el
 * rosa brillante de plataforma (`--pe-accent`) y un pelín más grande. Unifica
 * todos los "volver/regresar" del sistema (antes cada página tenía el suyo). El
 * texto llega YA traducido desde el padre. Presentacional puro (OnPush).
 */
@Component({
  selector: 'app-back-link',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <a class="pe-back" [routerLink]="link()" [queryParams]="queryParams()" [attr.data-testid]="testId()">
      <svg class="pe-back-arrow" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M15 5l-7 7 7 7" />
      </svg>
      <span>{{ label() }}</span>
    </a>
  `,
  styles: [
    `
      .pe-back {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        color: var(--pe-accent);
        font-weight: 700;
        font-size: 1.02rem;
        line-height: 1.2;
        padding: 0.25rem 0.1rem;
        transition: color 0.15s ease, transform 0.12s ease;
      }
      .pe-back:hover {
        color: var(--pe-accent-strong);
      }
      .pe-back:hover .pe-back-arrow {
        transform: translateX(-3px);
      }
      .pe-back-arrow {
        transition: transform 0.12s ease;
      }
    `,
  ],
})
export class BackLinkComponent {
  /** Ruta destino (routerLink). */
  readonly link = input.required<string | unknown[]>();
  /** Query params opcionales del destino. */
  readonly queryParams = input<Params | null>(null);
  /** Etiqueta ya traducida. */
  readonly label = input.required<string>();
  /** data-testid opcional (para specs existentes). */
  readonly testId = input<string>('back-link');
}
