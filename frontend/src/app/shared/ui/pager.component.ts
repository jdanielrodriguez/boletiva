import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/**
 * Paginador COMPARTIDO y homogéneo (mismo estilo que el catálogo de inicio):
 * flechas ‹ › + indicador "n / total". Emite `pageChange` con la página destino
 * (ya acotada a [1, total]). Se oculta solo si hay una sola página, salvo que se
 * fuerce `alwaysShow`. Reemplaza los paginadores ad-hoc de las distintas listas.
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
          (click)="go(page() - 1)"
          aria-label="Página anterior"
          title="Anterior"
          data-testid="pager-prev"
        >‹</button>
        <span class="pager-page is-current" data-testid="pager-current">{{ page() }} / {{ total() }}</span>
        <button
          type="button"
          class="pager-arrow"
          [disabled]="page() >= total()"
          (click)="go(page() + 1)"
          aria-label="Página siguiente"
          title="Siguiente"
          data-testid="pager-next"
        >›</button>
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

  protected go(p: number): void {
    const next = Math.min(Math.max(1, p), this.total());
    if (next !== this.page()) this.pageChange.emit(next);
  }
}
