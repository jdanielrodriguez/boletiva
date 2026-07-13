import { ChangeDetectionStrategy, Component, input, linkedSignal, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { IconComponent } from '../icon/icon.component';

/**
 * Campo de búsqueda homogéneo (v3.10 · GIII). Renderiza el `<input type=search>`
 * con la LUPITA dentro del field, alineada a la derecha. Comportamiento:
 * - cada tecla emite `valueChange` → alimenta los filtros reactivos por signal;
 * - Enter o clic en la lupita emiten `search` → los buscadores no reactivos
 *   (p.ej. catálogo, que navega) disparan la búsqueda.
 * El `data-testid` se propaga al `<input>` (y `<testId>-btn` a la lupita) para no
 * romper los E2E existentes. Reutilizable en `.list-filters`, `.field` y catálogo.
 */
@Component({
  selector: 'app-search-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslatePipe, IconComponent],
  template: `
    <div class="search-field">
      <input
        type="search"
        [ngModel]="draft()"
        (ngModelChange)="onInput($event)"
        (keydown.enter)="emitSearch($event)"
        [attr.name]="name()"
        [attr.placeholder]="placeholder()"
        [attr.aria-label]="ariaLabel() || placeholder()"
        [attr.data-testid]="testId() || null"
      />
      <button
        type="button"
        class="search-field-btn"
        (click)="emitSearch()"
        [title]="'common.search' | translate"
        [attr.aria-label]="'common.search' | translate"
        [attr.data-testid]="testId() ? testId() + '-btn' : null"
      >
        <app-icon name="search" />
      </button>
    </div>
  `,
})
export class SearchFieldComponent {
  readonly value = input('');
  readonly placeholder = input('');
  readonly ariaLabel = input('');
  readonly name = input('q');
  readonly testId = input('');

  readonly valueChange = output<string>();
  readonly searched = output<string>();

  /** Borrador local sembrado desde `value`; se resetea si el padre cambia `value`. */
  protected readonly draft = linkedSignal(() => this.value());

  protected onInput(v: string): void {
    this.draft.set(v);
    this.valueChange.emit(v);
  }

  protected emitSearch(ev?: Event): void {
    ev?.preventDefault();
    this.searched.emit(this.draft());
  }
}
