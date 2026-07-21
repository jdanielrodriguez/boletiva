import {
  Component,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  inject,
  model,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';

interface ToolbarButton {
  cmd: string;
  arg?: string;
  label: string;
  icon: string;
}

/**
 * Editor de texto enriquecido ligero (T6): contenteditable + toolbar con `execCommand`
 * (negrita/cursiva/subrayado, encabezados, listas, enlace, limpiar). Emite el HTML por
 * el modelo `value` (two-way). SSR-safe: el DOM solo se toca en el navegador
 * (afterNextRender). El HTML se SANEA de nuevo en el backend al guardar.
 */
@Component({
  selector: 'app-rich-text-editor',
  imports: [TranslatePipe],
  template: `
    <div class="rte">
      <div class="rte-toolbar" role="toolbar" [attr.aria-label]="'rte.toolbar' | translate">
        @for (b of buttons; track b.cmd + b.arg) {
          <button
            type="button"
            class="rte-btn"
            [title]="b.label | translate"
            [attr.aria-label]="b.label | translate"
            (mousedown)="$event.preventDefault()"
            (click)="exec(b.cmd, b.arg)"
          >
            <span [innerHTML]="b.icon"></span>
          </button>
        }
        <button
          type="button"
          class="rte-btn"
          [title]="'rte.link' | translate"
          [attr.aria-label]="'rte.link' | translate"
          (mousedown)="$event.preventDefault()"
          (click)="link()"
        >
          🔗
        </button>
      </div>
      <div
        #editor
        class="rte-body"
        contenteditable="true"
        role="textbox"
        aria-multiline="true"
        [attr.data-placeholder]="'rte.placeholder' | translate"
        (input)="onInput()"
        (blur)="onInput()"
        data-testid="rte-body"
      ></div>
    </div>
  `,
})
export class RichTextEditorComponent {
  private readonly platformId = inject(PLATFORM_ID);
  readonly value = model<string>('');
  private readonly editorRef = viewChild<ElementRef<HTMLElement>>('editor');
  private lastSet = '';

  protected readonly buttons: ToolbarButton[] = [
    { cmd: 'bold', label: 'rte.bold', icon: '<b>B</b>' },
    { cmd: 'italic', label: 'rte.italic', icon: '<i>I</i>' },
    { cmd: 'underline', label: 'rte.underline', icon: '<u>U</u>' },
    { cmd: 'formatBlock', arg: 'h2', label: 'rte.h2', icon: 'H2' },
    { cmd: 'formatBlock', arg: 'h3', label: 'rte.h3', icon: 'H3' },
    { cmd: 'insertUnorderedList', label: 'rte.ul', icon: '• —' },
    { cmd: 'insertOrderedList', label: 'rte.ol', icon: '1.' },
    { cmd: 'formatBlock', arg: 'blockquote', label: 'rte.quote', icon: '”' },
    { cmd: 'removeFormat', label: 'rte.clear', icon: '⨯' },
  ];

  constructor() {
    afterNextRender(() => this.syncFromValue());
  }

  /** Refleja el valor externo en el editor (al cargar/editar un artículo). */
  private syncFromValue(): void {
    const el = this.editorRef()?.nativeElement;
    if (!el) return;
    const v = this.value() ?? '';
    if (v !== this.lastSet) {
      el.innerHTML = v;
      this.lastSet = v;
    }
  }

  protected exec(cmd: string, arg?: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.editorRef()?.nativeElement.focus();
    document.execCommand(cmd, false, arg);
    this.onInput();
  }

  protected link(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const url = window.prompt('URL (https://…)');
    if (!url) return;
    if (!/^(https?:|mailto:)/i.test(url)) return;
    this.exec('createLink', url);
  }

  protected onInput(): void {
    const el = this.editorRef()?.nativeElement;
    if (!el) return;
    this.lastSet = el.innerHTML;
    this.value.set(el.innerHTML);
  }
}
