import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Ilustración según el contexto del vacío (o 'error' para un fallo de carga). */
export type EmptyVariant = 'tickets' | 'billing' | 'wallet' | 'card' | 'generic' | 'error';

/**
 * Estado vacío BONITO y reutilizable: en vez de una sola línea de texto muestra un
 * bloque centrado con una ilustración (SVG inline por `variant`), título y
 * subtítulo, un "skeleton censurado" opcional (líneas difuminadas que insinúan
 * contenido oculto) y un CTA opcional (routerLink). Los textos llegan YA
 * traducidos desde el padre (pipe `translate`), así el componente no depende del
 * diccionario. Presentacional puro (OnPush).
 */
@Component({
  selector: 'app-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="empty-state" [class.empty-state--error]="variant() === 'error'" data-testid="empty-state">
      <div class="empty-illustration" aria-hidden="true">
        @switch (variant()) {
          @case ('tickets') {
            <svg viewBox="0 0 64 64" width="72" height="72" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 20a4 4 0 0 1 4-4h40a4 4 0 0 1 4 4v6a4 4 0 0 0 0 12v6a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4v-6a4 4 0 0 0 0-12z" />
              <path d="M40 16v32" stroke-dasharray="3 4" />
            </svg>
          }
          @case ('billing') {
            <svg viewBox="0 0 64 64" width="72" height="72" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 6h28l8 8v44l-6-4-6 4-6-4-6 4-6-4-6 4V6z" />
              <path d="M22 22h20M22 32h20M22 42h12" />
            </svg>
          }
          @case ('wallet') {
            <svg viewBox="0 0 64 64" width="72" height="72" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 18a4 4 0 0 1 4-4h34a2 2 0 0 1 2 2v6" />
              <path d="M8 18v28a4 4 0 0 0 4 4h40a4 4 0 0 0 4-4V28a4 4 0 0 0-4-4H12a4 4 0 0 1-4-4z" />
              <circle cx="44" cy="36" r="3" />
            </svg>
          }
          @case ('card') {
            <svg viewBox="0 0 64 64" width="72" height="72" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="6" y="14" width="52" height="36" rx="4" />
              <path d="M6 26h52" />
              <path d="M14 40h10" stroke-dasharray="2 3" />
            </svg>
          }
          @case ('error') {
            <!-- Fallo de carga: triángulo de aviso (distinto del vacío legítimo). -->
            <svg viewBox="0 0 64 64" width="72" height="72" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M32 8 4 56h56z" />
              <path d="M32 26v14" />
              <circle cx="32" cy="48" r="1.5" fill="currentColor" stroke="none" />
            </svg>
          }
          @default {
            <!-- Bandeja vacía (neutro y amable) en vez de carita triste. -->
            <svg viewBox="0 0 64 64" width="72" height="72" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 34l5-18a4 4 0 0 1 3.9-2.9h22.2A4 4 0 0 1 47 16l5 18" />
              <path d="M12 34h11l3 5h12l3-5h11v12a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4z" />
            </svg>
          }
        }
      </div>

      <h3 class="empty-title">{{ title() }}</h3>
      @if (subtitle()) {
        <p class="empty-subtitle muted">{{ subtitle() }}</p>
      }

      @if (retryLabel()) {
        <button type="button" class="btn primary empty-cta" (click)="retry.emit()" data-testid="empty-retry">
          {{ retryLabel() }}
        </button>
      }

      @if (skeleton()) {
        <div class="empty-skeleton" aria-hidden="true">
          @for (w of skeletonRows; track $index) {
            <span class="skeleton-line" [style.width.%]="w"></span>
          }
        </div>
      }

      @if (ctaLabel() && ctaLink()) {
        <a class="btn primary empty-cta" [routerLink]="ctaLink()" data-testid="empty-cta">{{ ctaLabel() }}</a>
      }
    </div>
  `,
  styles: [
    `
      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 0.6rem;
        padding: 2.5rem 1.25rem;
        border: 1px dashed var(--pe-border);
        border-radius: var(--pe-radius);
        background: var(--pe-grad-soft);
      }
      .empty-illustration {
        color: var(--pe-primary);
        display: grid;
        place-items: center;
        width: 108px;
        height: 108px;
        border-radius: 50%;
        background: var(--pe-accent-soft);
        margin-bottom: 0.25rem;
      }
      /* Variante de ERROR de carga (C6): el fallo debe LEERSE como problema, no como
         un vacío alegre → ilustración en tono de peligro, no de marca. */
      .empty-state--error .empty-illustration {
        color: var(--pe-danger);
        background: var(--pe-danger-soft);
      }
      .empty-title {
        margin: 0;
        font-size: 1.15rem;
      }
      .empty-subtitle {
        margin: 0;
        max-width: 34rem;
      }
      .empty-skeleton {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.55rem;
        width: min(28rem, 100%);
        margin: 0.75rem 0 0.25rem;
      }
      .skeleton-line {
        height: 0.85rem;
        border-radius: 6px;
        background: linear-gradient(90deg, var(--pe-surface-2), var(--pe-surface), var(--pe-surface-2));
        filter: blur(1px);
        opacity: 0.7;
      }
      .empty-cta {
        margin-top: 0.9rem;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.62rem 1.35rem;
        border-radius: 999px;
        font-weight: 600;
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.14);
        transition: transform 0.12s ease, box-shadow 0.12s ease, filter 0.12s ease;
      }
      .empty-cta:hover {
        transform: translateY(-1px);
        box-shadow: 0 12px 26px rgba(0, 0, 0, 0.2);
        filter: brightness(1.03);
      }
      .empty-cta:active {
        transform: translateY(0);
      }
    `,
  ],
})
export class EmptyStateComponent {
  readonly variant = input<EmptyVariant>('generic');
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
  /** Muestra el "skeleton censurado" (líneas difuminadas) bajo el texto. */
  readonly skeleton = input(false);
  /** Etiqueta del CTA (ya traducida); requiere `ctaLink` para renderizarse. */
  readonly ctaLabel = input<string>('');
  /** Ruta del CTA (routerLink), p.ej. `/`. */
  readonly ctaLink = input<string>('');
  /** Etiqueta del botón "reintentar" (ya traducida); si se define, se muestra el botón
   * y al pulsarlo emite `retry`. Para el estado de error de carga (C6). */
  readonly retryLabel = input<string>('');
  /** Se emite al pulsar "reintentar". */
  readonly retry = output<void>();

  /** Anchos (%) de las líneas del skeleton — insinúan contenido variable. */
  protected readonly skeletonRows = [90, 72, 84, 60];
}
