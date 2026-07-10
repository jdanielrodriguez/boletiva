import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/**
 * Paginador COMPARTIDO y homogéneo — misma apariencia que el catálogo de inicio:
 * páginas NUMERADAS con flechas « ‹ › » y elipsis (…) para rangos grandes.
 * Es la ÚNICA fuente del paginador de la app (catálogo, panel, cuenta, consola).
 * Emite `pageChange` con la página destino (acotada a [1, total]). Se oculta con
 * una sola página salvo `alwaysShow`.
 */
@Component({
  selector: 'app-pager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (alwaysShow() || total() > 1) {
      <nav class="catalog-pager" [attr.aria-label]="label()" data-testid="pager">
        <button
          type="button"
          class="pager-arrow"
          [disabled]="page() <= 1"
          (click)="go(1)"
          aria-label="Primera página"
          title="Primera página"
          data-testid="pager-first"
        >«</button>
        <button
          type="button"
          class="pager-arrow"
          [disabled]="page() <= 1"
          (click)="go(page() - 1)"
          aria-label="Página anterior"
          title="Anterior"
          data-testid="pager-prev"
        >‹</button>

        <ul class="pager-pages">
          @for (item of pageItems(); track $index) {
            @if (item === 'gap') {
              <li class="pager-gap" aria-hidden="true">…</li>
            } @else {
              <li>
                <button
                  type="button"
                  class="pager-page"
                  [class.is-current]="item.page === page()"
                  [attr.aria-current]="item.page === page() ? 'page' : null"
                  [attr.data-testid]="item.page === page() ? 'pager-current' : null"
                  (click)="go(item.page)"
                >{{ item.page }}</button>
              </li>
            }
          }
        </ul>

        <button
          type="button"
          class="pager-arrow"
          [disabled]="page() >= total()"
          (click)="go(page() + 1)"
          aria-label="Página siguiente"
          title="Siguiente"
          data-testid="pager-next"
        >›</button>
        <button
          type="button"
          class="pager-arrow"
          [disabled]="page() >= total()"
          (click)="go(total())"
          aria-label="Última página"
          title="Última página"
          data-testid="pager-last"
        >»</button>
      </nav>
    }
  `,
})
export class PagerComponent {
  readonly page = input.required<number>();
  readonly totalPages = input.required<number>();
  readonly label = input('Paginación');
  readonly alwaysShow = input(false);
  readonly pageChange = output<number>();

  protected readonly total = computed(() => Math.max(1, this.totalPages()));

  /**
   * Preview compacto de páginas: siempre la 1 y la última; una ventana de ±1 en
   * torno a la actual; huecos ('gap') donde se saltan páginas. Con ≤7 páginas se
   * muestran todas.
   */
  protected readonly pageItems = computed<({ page: number } | 'gap')[]>(() => {
    const total = this.total();
    const current = Math.min(Math.max(1, this.page()), total);
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => ({ page: i + 1 }));
    }
    const nums = new Set<number>([1, total, current, current - 1, current + 1]);
    const sorted = [...nums].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
    const items: ({ page: number } | 'gap')[] = [];
    let prev = 0;
    for (const n of sorted) {
      if (n - prev > 1) items.push('gap');
      items.push({ page: n });
      prev = n;
    }
    return items;
  });

  protected go(p: number): void {
    const next = Math.min(Math.max(1, p), this.total());
    if (next !== this.page()) this.pageChange.emit(next);
  }
}
