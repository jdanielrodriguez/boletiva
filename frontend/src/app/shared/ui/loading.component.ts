import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Forma del indicador: spinner girando o bloque de skeleton. */
export type LoadingVariant = 'spinner' | 'skeleton';

/**
 * Indicador de carga reutilizable (v3.8 · G1). Dos formas:
 *  - `spinner` (default): anillo girando + etiqueta opcional, centrado.
 *  - `skeleton`: filas difuminadas que insinúan el contenido que llega.
 * Con `fullscreen` se convierte en overlay a pantalla completa (para tapar el
 * parpadeo de login mientras se hidrata la sesión). El texto llega YA traducido
 * desde el padre (o cae a un aria-label neutro). Presentacional puro (OnPush).
 */
@Component({
  selector: 'app-loading',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="pe-loading"
      [class.pe-loading--fullscreen]="fullscreen()"
      [class.pe-loading--block]="!fullscreen()"
      role="status"
      aria-live="polite"
      [attr.aria-label]="label() || 'loading'"
      data-testid="loading"
    >
      @if (variant() === 'skeleton') {
        <div class="pe-skel" aria-hidden="true">
          @for (w of skeletonRows(); track $index) {
            <span class="pe-skel-line" [style.width.%]="w"></span>
          }
        </div>
      } @else {
        <span class="pe-spinner" aria-hidden="true"></span>
      }
      @if (label()) {
        <p class="pe-loading-label muted">{{ label() }}</p>
      }
    </div>
  `,
  styles: [
    `
      .pe-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.85rem;
        color: var(--pe-muted);
      }
      .pe-loading--block {
        padding: 2.5rem 1rem;
        min-height: 8rem;
      }
      .pe-loading--fullscreen {
        position: fixed;
        inset: 0;
        z-index: 1000;
        background: var(--pe-bg);
        background-image: radial-gradient(900px 460px at 80% -10%, rgba(123, 92, 255, 0.14), transparent 70%),
          radial-gradient(760px 420px at -10% 0%, rgba(225, 78, 202, 0.1), transparent 70%);
      }
      .pe-spinner {
        width: 42px;
        height: 42px;
        border-radius: 50%;
        border: 3px solid var(--pe-surface-2);
        border-top-color: var(--pe-accent);
        animation: pe-spin 0.8s linear infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .pe-spinner {
          animation-duration: 2s;
        }
      }
      @keyframes pe-spin {
        to {
          transform: rotate(360deg);
        }
      }
      .pe-loading-label {
        margin: 0;
        font-size: 0.92rem;
      }
      .pe-skel {
        display: flex;
        flex-direction: column;
        gap: 0.7rem;
        width: min(34rem, 100%);
      }
      .pe-skel-line {
        height: 1rem;
        border-radius: 8px;
        background: linear-gradient(90deg, var(--pe-surface-2), var(--pe-surface), var(--pe-surface-2));
        background-size: 200% 100%;
        animation: pe-shimmer 1.4s ease-in-out infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .pe-skel-line {
          animation: none;
          opacity: 0.7;
        }
      }
      @keyframes pe-shimmer {
        0% {
          background-position: 200% 0;
        }
        100% {
          background-position: -200% 0;
        }
      }
    `,
  ],
})
export class LoadingComponent {
  /** Forma del indicador. */
  readonly variant = input<LoadingVariant>('spinner');
  /** Overlay a pantalla completa (tapa el contenido de debajo). */
  readonly fullscreen = input(false);
  /** Texto ya traducido; opcional. */
  readonly label = input<string>('');
  /** Anchos (%) de las líneas del skeleton. */
  readonly skeletonRows = input<number[]>([92, 76, 84, 64]);
}
