import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Ilustración según el contexto del vacío. */
export type EmptyVariant = 'tickets' | 'billing' | 'wallet' | 'card' | 'generic';

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
    <div class="empty-state" data-testid="empty-state">
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
          @default {
            <svg viewBox="0 0 64 64" width="72" height="72" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="32" cy="32" r="24" />
              <path d="M22 40c2-4 6-6 10-6s8 2 10 6M24 26h.02M40 26h.02" />
            </svg>
          }
        }
      </div>

      <h3 class="empty-title">{{ title() }}</h3>
      @if (subtitle()) {
        <p class="empty-subtitle muted">{{ subtitle() }}</p>
      }

      @if (skeleton()) {
        <div class="empty-skeleton" aria-hidden="true">
          @for (w of skeletonRows; track $index) {
            <span class="skeleton-line" [style.width.%]="w"></span>
          }
        </div>
      }

      @if (ctaLabel() && ctaLink()) {
        <a class="primary empty-cta" [routerLink]="ctaLink()" data-testid="empty-cta">{{ ctaLabel() }}</a>
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
        background: rgba(123, 92, 255, 0.12);
        margin-bottom: 0.25rem;
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
        margin-top: 0.75rem;
        text-decoration: none;
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

  /** Anchos (%) de las líneas del skeleton — insinúan contenido variable. */
  protected readonly skeletonRows = [90, 72, 84, 60];
}
