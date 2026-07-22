import { Component, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { KbApi, KbArticle, KbCategory, KbVisibility } from '../../core/api/kb.api';
import { BackLinkComponent } from '../../shared/ui/back-link.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { LoadingComponent } from '../../shared/ui/loading.component';
import { RichTextEditorComponent } from '../../shared/rich-text-editor/rich-text-editor.component';

interface EditModel {
  id: string | null;
  question: string;
  answerHtml: string;
  category: KbCategory | '';
  visibility: KbVisibility;
  locale: string;
  tags: string;
  sortOrder: number;
}

const EMPTY: EditModel = {
  id: null,
  question: '',
  answerHtml: '',
  category: '',
  visibility: 'public',
  locale: 'es',
  tags: '',
  sortOrder: 0,
};

const CATEGORIES: KbCategory[] = ['account', 'payments_settlement', 'billing', 'event', 'technical', 'other'];

/**
 * Gestión de la Base de Conocimientos (T6): listar, crear/editar con editor de formato,
 * publicar/despublicar y eliminar. Admin + asesor. El HTML se sanea en el backend.
 */
@Component({
  selector: 'app-kb-admin',
  imports: [
    FormsModule,
    TranslatePipe,
    BackLinkComponent,
    EmptyStateComponent,
    LoadingComponent,
    RichTextEditorComponent,
  ],
  templateUrl: './kb-admin.page.html',
})
export class KbAdminPage {
  private readonly kb = inject(KbApi);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly categories = CATEGORIES;
  protected readonly articles = signal<KbArticle[] | null>(null);
  protected readonly errored = signal(false);
  protected readonly editing = signal<EditModel | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal('');
  protected readonly actionError = signal('');

  constructor() {
    if (isPlatformBrowser(this.platformId)) this.load();
  }

  private load(): void {
    this.errored.set(false);
    this.kb.adminList().subscribe({
      next: (list) => this.articles.set(list),
      error: () => {
        this.articles.set([]);
        this.errored.set(true);
      },
    });
  }

  protected newArticle(): void {
    this.saveError.set('');
    this.editing.set({ ...EMPTY });
  }

  protected edit(a: KbArticle): void {
    this.saveError.set('');
    this.editing.set({
      id: a.id,
      question: a.question,
      answerHtml: a.answerHtml,
      category: a.category ?? '',
      visibility: a.visibility,
      locale: a.locale,
      tags: (a.tags ?? []).join(', '),
      sortOrder: a.sortOrder,
    });
  }

  protected cancel(): void {
    this.editing.set(null);
  }

  protected save(): void {
    const m = this.editing();
    if (!m) return;
    if (m.question.trim().length < 3 || m.answerHtml.trim().length < 1) {
      this.saveError.set('kb.validation');
      return;
    }
    this.saving.set(true);
    this.saveError.set('');
    const dto = {
      question: m.question.trim(),
      answerHtml: m.answerHtml,
      category: m.category || null,
      visibility: m.visibility,
      locale: m.locale,
      tags: m.tags.split(',').map((t) => t.trim()).filter(Boolean),
      sortOrder: Number(m.sortOrder) || 0,
    };
    const req = m.id ? this.kb.update(m.id, dto) : this.kb.create(dto);
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.editing.set(null);
        this.load();
      },
      error: () => {
        this.saving.set(false);
        this.saveError.set('kb.saveError');
      },
    });
  }

  protected togglePublish(a: KbArticle): void {
    this.actionError.set('');
    const req = a.status === 'published' ? this.kb.unpublish(a.id) : this.kb.publish(a.id);
    req.subscribe({ next: () => this.load(), error: () => this.actionError.set('kb.actionError') });
  }

  protected remove(a: KbArticle): void {
    if (isPlatformBrowser(this.platformId) && !window.confirm(a.question)) return;
    this.actionError.set('');
    this.kb.remove(a.id).subscribe({ next: () => this.load(), error: () => this.actionError.set('kb.actionError') });
  }
}
