import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { SeatTemplatesApi } from '../../core/api/seat-templates.api';
import { ToastService } from '../../core/ui/toast.service';
import {
  ConfirmDialogComponent,
  type ConfirmRequest,
} from '../../shared/confirm-dialog/confirm-dialog.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { PagerComponent } from '../../shared/ui/pager.component';
import { SearchFieldComponent } from '../../shared/ui/search-field.component';
import { StatusLabelPipe } from '../../shared/ui/status-label.pipe';
import type { SeatTemplateResponseDto } from '../../core/api/types';

const PAGE = 9;

/**
 * Lista de PLANTILLAS de asientos embebida en el tab `?tab=plantillas` de la
 * consola (v3.9 · B1). SOLO la lista con filtros (buscador + estado) y paginación;
 * la creación/edición vive en una página aparte (`template-edit.page`). Al cambiar
 * de tab en la consola el `@switch` destruye/recrea este componente → los filtros
 * vuelven a su estado inicial. Botones: Ver (preview, solo publicadas),
 * Publicar/Regresar-a-borrador, Ocultar/Mostrar, Deshabilitar/Habilitar, Editar
 * (solo draft no-built-in → navega), Eliminar (solo deshabilitada no-built-in).
 */
@Component({
  selector: 'app-templates-list',
  imports: [
    FormsModule,
    TranslatePipe,
    StatusLabelPipe,
    IconComponent,
    ConfirmDialogComponent,
    PagerComponent,
    EmptyStateComponent,
    SearchFieldComponent,
  ],
  templateUrl: './templates-list.component.html',
})
export class TemplatesListComponent {
  private readonly templatesApi = inject(SeatTemplatesApi);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly router = inject(Router);

  protected readonly templates = signal<SeatTemplateResponseDto[]>([]);
  protected readonly search = signal('');
  protected readonly statusFilter = signal<string>('');
  protected readonly preview = signal<SeatTemplateResponseDto | null>(null);
  protected readonly page = signal(1);

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
  /** True cuando hay un filtro/búsqueda activo (para distinguir vacío-total de sin-resultados). */
  protected readonly hasFilter = computed(() => this.search().trim().length > 0 || this.statusFilter() !== '');

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

  /**
   * Una plantilla es editable si NO es built-in y está en borrador O desactivada
   * (paridad con salones, v3.10 · GII). Las built-in del sistema quedan protegidas.
   */
  protected canEditState(t: SeatTemplateResponseDto): boolean {
    return !t.isBuiltIn && (t.status === 'draft' || t.disabled);
  }

  // --- Crear / editar (navegan a la página aparte) ---
  protected newTemplate(): void {
    void this.router.navigate(['/configuracion/plantillas/nuevo']);
  }
  protected editTemplate(t: SeatTemplateResponseDto): void {
    if (!this.canEditState(t)) {
      this.toasts.warning(this.translate.instant('config.templates.builtInEditWarn'));
      return;
    }
    void this.router.navigate(['/configuracion/plantillas', t.id, 'editar']);
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
  // --- Publicar (con modal de confirmación, v3.9 · B3) ---
  protected askPublish(t: SeatTemplateResponseDto): void {
    this.confirm.set({
      title: this.translate.instant('config.templates.publishConfirmTitle'),
      message: this.translate.instant('config.templates.publishConfirmMessage', { name: t.name }),
      confirmLabel: this.translate.instant('config.templates.publish'),
      confirmIcon: 'publish',
      titleIcon: 'publish',
      danger: false,
      auditAction: 'template.publish',
      auditResource: t.id,
      onConfirm: () => this.publish(t),
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
