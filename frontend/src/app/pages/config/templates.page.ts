import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { SeatTemplatesApi } from '../../core/api/seat-templates.api';
import { ToastService } from '../../core/ui/toast.service';
import {
  ConfirmDialogComponent,
  type ConfirmRequest,
} from '../../shared/confirm-dialog/confirm-dialog.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { PagerComponent } from '../../shared/ui/pager.component';
import { StatusLabelPipe } from '../../shared/ui/status-label.pipe';
import type { SeatTemplateResponseDto } from '../../core/api/types';

/** Borrador editable de una plantilla de asientos. */
interface TemplateDraft {
  id: string | null;
  name: string;
  kind: string;
  paramsJson: string;
}

const PAGE = 9;

/**
 * Página dedicada de gestión de PLANTILLAS de asientos (v3.7, solo admin). Filtros
 * por estado (todos/publicadas/borrador/ocultas/deshabilitadas) + buscador +
 * paginación. Botones: Ver (preview, solo publicadas), Publicar/Despublicar,
 * Ocultar/Mostrar, Deshabilitar/Habilitar, Eliminar (solo deshabilitadas). Las
 * built-in del sistema no se editan/eliminan pero SÍ se ocultan/deshabilitan.
 */
@Component({
  selector: 'app-templates-page',
  imports: [
    FormsModule,
    RouterLink,
    TranslatePipe,
    StatusLabelPipe,
    IconComponent,
    ConfirmDialogComponent,
    PagerComponent,
  ],
  templateUrl: './templates.page.html',
})
export class TemplatesPage {
  private readonly templatesApi = inject(SeatTemplatesApi);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly templates = signal<SeatTemplateResponseDto[]>([]);
  protected readonly search = signal('');
  protected readonly statusFilter = signal<string>('');
  protected readonly draft = signal<TemplateDraft | null>(null);
  protected readonly preview = signal<SeatTemplateResponseDto | null>(null);
  protected readonly page = signal(1);
  protected readonly templateKinds = ['rows', 'theater', 'stadium', 'tables', 'grid', 'curve', 'line', 'custom'];

  /** Estados para el filtro (value interno; label capitalizado en la UI). */
  protected readonly statusOptions = ['published', 'draft', 'hidden', 'disabled'];

  /** Estado de display de una plantilla (prioridad: disabled > hidden > status). */
  protected displayState(t: SeatTemplateResponseDto): string {
    if (t.disabled) return 'disabled';
    if (t.hidden) return 'hidden';
    return t.status;
  }

  protected readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const st = this.statusFilter();
    return this.templates().filter((t) => {
      if (st && this.displayState(t) !== st) return false;
      if (!q) return true;
      return t.name.toLowerCase().includes(q);
    });
  });
  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / PAGE)));
  protected readonly pageItems = computed(() => {
    const start = (this.page() - 1) * PAGE;
    return this.filtered().slice(start, start + PAGE);
  });

  constructor() {
    this.load();
  }

  private load(): void {
    this.templatesApi.listAll().subscribe({
      next: (t) => this.templates.set(t),
      error: () => this.toasts.error(this.translate.instant('config.templates.loadError')),
    });
  }

  protected goToPage(p: number): void {
    this.page.set(Math.min(Math.max(1, p), this.totalPages()));
  }
  protected setSearch(v: string): void {
    this.search.set(v);
    this.page.set(1);
  }
  protected setStatus(v: string): void {
    this.statusFilter.set(v);
    this.page.set(1);
  }

  /** SVG del icono (built-in) sanitizado para el preview. */
  protected iconHtml(t: SeatTemplateResponseDto): SafeHtml | null {
    const icon = (t.layoutJson as { icon?: string } | null)?.icon;
    return icon ? this.sanitizer.bypassSecurityTrustHtml(icon) : null;
  }
  protected paramsText(t: SeatTemplateResponseDto): string {
    return t.params ? JSON.stringify(t.params, null, 2) : '—';
  }

  // --- Preview (solo publicadas) ---
  protected openPreview(t: SeatTemplateResponseDto): void {
    this.preview.set(t);
  }
  protected closePreview(): void {
    this.preview.set(null);
  }

  // --- Crear / editar ---
  protected newTemplate(): void {
    this.draft.set({ id: null, name: '', kind: 'grid', paramsJson: '{"rows":5,"cols":10}' });
  }
  protected editTemplate(t: SeatTemplateResponseDto): void {
    if (t.isBuiltIn) {
      this.toasts.warning(this.translate.instant('config.templates.builtInEditWarn'));
      return;
    }
    this.draft.set({
      id: t.id,
      name: t.name,
      kind: t.kind,
      paramsJson: t.params ? JSON.stringify(t.params) : '',
    });
  }
  protected cancelEdit(): void {
    this.draft.set(null);
  }
  protected patch<K extends keyof TemplateDraft>(key: K, value: TemplateDraft[K]): void {
    const d = this.draft();
    if (d) this.draft.set({ ...d, [key]: value });
  }
  protected save(): void {
    const d = this.draft();
    if (!d || d.name.trim().length < 2) {
      this.toasts.warning(this.translate.instant('config.templates.nameRequired'));
      return;
    }
    let params: Record<string, unknown> | undefined;
    if (d.paramsJson.trim()) {
      try {
        params = JSON.parse(d.paramsJson) as Record<string, unknown>;
      } catch {
        this.toasts.warning(this.translate.instant('config.templates.paramsJsonInvalid'));
        return;
      }
    }
    const body = { name: d.name.trim(), kind: d.kind as never, params };
    const req = d.id ? this.templatesApi.update(d.id, body) : this.templatesApi.create(body);
    req.subscribe({
      next: () => {
        this.toasts.success(this.translate.instant(d.id ? 'config.templates.updated' : 'config.templates.created'));
        this.draft.set(null);
        this.load();
      },
      error: (err: { status?: number }) =>
        this.toasts.error(
          this.translate.instant(
            err?.status === 409 ? 'config.templates.builtInSaveError' : 'config.templates.saveError',
          ),
        ),
    });
  }

  // --- Transiciones de estado ---
  private transition(obs: ReturnType<SeatTemplatesApi['publish']>, msg: string): void {
    obs.subscribe({
      next: () => {
        this.toasts.success(this.translate.instant(msg));
        this.load();
      },
      error: () => this.toasts.error(this.translate.instant('config.templates.stateError')),
    });
  }
  protected publish(t: SeatTemplateResponseDto): void {
    this.transition(this.templatesApi.publish(t.id), 'config.templates.published');
  }
  protected unpublish(t: SeatTemplateResponseDto): void {
    this.transition(this.templatesApi.unpublish(t.id), 'config.templates.unpublished');
  }
  protected hide(t: SeatTemplateResponseDto): void {
    this.transition(this.templatesApi.hide(t.id), 'config.templates.hidden');
  }
  protected unhide(t: SeatTemplateResponseDto): void {
    this.transition(this.templatesApi.unhide(t.id), 'config.templates.shown');
  }
  protected disable(t: SeatTemplateResponseDto): void {
    this.transition(this.templatesApi.disable(t.id), 'config.templates.disabled');
  }
  protected enable(t: SeatTemplateResponseDto): void {
    this.transition(this.templatesApi.enable(t.id), 'config.templates.enabled');
  }

  /** El botón Eliminar solo se habilita si la plantilla está deshabilitada y no es built-in. */
  protected canDelete(t: SeatTemplateResponseDto): boolean {
    return t.disabled && !t.isBuiltIn;
  }

  // --- Confirmación de borrado ---
  protected readonly confirm = signal<ConfirmRequest | null>(null);
  protected onConfirmAccept(): void {
    const c = this.confirm();
    this.confirm.set(null);
    c?.onConfirm();
  }
  protected onConfirmCancel(): void {
    this.confirm.set(null);
  }
  protected askRemove(t: SeatTemplateResponseDto): void {
    if (!this.canDelete(t)) {
      this.toasts.warning(this.translate.instant('config.templates.deleteBlocked'));
      return;
    }
    this.confirm.set({
      title: this.translate.instant('config.templates.removeConfirmTitle'),
      message: this.translate.instant('config.templates.removeConfirmMessage', { name: t.name }),
      confirmLabel: this.translate.instant('common.delete'),
      confirmIcon: 'delete',
      onConfirm: () =>
        this.templatesApi.remove(t.id).subscribe({
          next: () => {
            this.toasts.info(this.translate.instant('config.templates.removed'));
            this.load();
          },
          error: () => this.toasts.error(this.translate.instant('config.templates.removeError')),
        }),
    });
  }
}
