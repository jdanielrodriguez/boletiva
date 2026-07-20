import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Icono de la confirmación según el contexto. */
export type SplashIcon = 'check' | 'mail';

/**
 * Pantalla de CONFIRMACIÓN bonita y temporal (v3.9 · D1/D2). Bloque centrado con
 * un icono grande en un halo, título, mensaje y un loader INTEGRADO (no pegado a
 * un botón) que insinúa la redirección en curso. Reutilizable para:
 *  - compra/transacción exitosa (icono `check`),
 *  - "verifica tu correo" tras el registro (icono `mail`).
 * El padre controla el temporizador y la redirección; este componente es
 * presentacional puro (OnPush). Los textos llegan YA traducidos. El CTA opcional
 * se proyecta con `<ng-content>` (para conservar routerLink/href del padre).
 */
@Component({
  selector: 'app-confirmation-splash',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="splash" data-testid="confirmation-splash" role="status" aria-live="polite">
      <span class="splash-halo" [class.splash-halo--mail]="icon() === 'mail'" aria-hidden="true">
        @if (icon() === 'mail') {
          <svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2.5" />
            <path d="M4 7l8 6 8-6" />
          </svg>
        } @else {
          <svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M8 12.5l2.5 2.5L16 9" />
          </svg>
        }
      </span>

      <h2 class="splash-title">{{ title() }}</h2>
      @if (message()) {
        <p class="splash-message muted">{{ message() }}</p>
      }

      @if (redirectLabel()) {
        <p class="splash-redirect" data-testid="splash-redirect">
          <span class="splash-spinner" aria-hidden="true"></span>
          <span>{{ redirectLabel() }}</span>
        </p>
      }

      <div class="splash-cta">
        <ng-content></ng-content>
      </div>
    </div>
  `,
  styles: [
    `
      .splash {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 0.65rem;
        padding: 3rem 1.25rem;
        max-width: 34rem;
        margin: 0 auto;
      }
      .splash-halo {
        display: grid;
        place-items: center;
        width: 108px;
        height: 108px;
        border-radius: 50%;
        color: var(--pe-teal, #2dd4bf);
        background: rgba(45, 212, 191, 0.14);
        margin-bottom: 0.4rem;
        animation: splash-pop 0.4s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .splash-halo--mail {
        color: var(--pe-primary);
        background: color-mix(in srgb, var(--pe-primary) 14%, transparent);
      }
      @media (prefers-reduced-motion: reduce) {
        .splash-halo {
          animation: none;
        }
      }
      @keyframes splash-pop {
        from {
          transform: scale(0.7);
          opacity: 0;
        }
        to {
          transform: scale(1);
          opacity: 1;
        }
      }
      .splash-title {
        margin: 0;
        font-size: 1.4rem;
      }
      .splash-message {
        margin: 0;
      }
      .splash-redirect {
        display: inline-flex;
        align-items: center;
        gap: 0.55rem;
        margin: 0.6rem 0 0;
        font-size: 0.9rem;
        color: var(--pe-muted);
      }
      .splash-spinner {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: 2.5px solid var(--pe-surface-2);
        border-top-color: var(--pe-accent, #e14eca);
        animation: splash-spin 0.8s linear infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .splash-spinner {
          animation-duration: 2s;
        }
      }
      @keyframes splash-spin {
        to {
          transform: rotate(360deg);
        }
      }
      .splash-cta {
        margin-top: 1rem;
      }
      .splash-cta:empty {
        display: none;
      }
    `,
  ],
})
export class ConfirmationSplashComponent {
  /** Icono del halo (check para éxito, mail para verificación). */
  readonly icon = input<SplashIcon>('check');
  /** Título ya traducido. */
  readonly title = input.required<string>();
  /** Mensaje opcional ya traducido. */
  readonly message = input<string>('');
  /** Texto junto al loader (p.ej. "Redirigiendo…"); si vacío, no muestra loader. */
  readonly redirectLabel = input<string>('');
}
