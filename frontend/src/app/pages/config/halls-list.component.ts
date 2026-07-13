import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { HallsApi } from '../../core/api/halls.api';
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
import type { HallResponseDto } from '../../core/api/types';

const PAGE = 9;

/**
 * Lista de SALONES embebida en el tab `?tab=salones` de la consola (v3.9 · B1).
 * SOLO la lista con filtros (buscador + estado) y paginación; la creación/edición
 * vive en una página aparte (`hall-edit.page`) a la que navegan "Nuevo salón" y
 * "Editar". Al cambiar de tab en la consola el `@switch` destruye/recrea este
 * componente → los filtros vuelven a su estado inicial. Estados: los PUBLICADOS
 * solo se regresan a borrador; los BORRADORES se publican, editan y eliminan.
 */
@Component({
  selector: 'app-halls-list',
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
  templateUrl: './halls-list.component.html',
})
export class HallsListComponent {
  private readonly hallsApi = inject(HallsApi);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);

  protected readonly halls = signal<HallResponseDto[]>([]);
  protected readonly search = signal('');
  protected readonly statusFilter = signal<string>('');
  protected readonly page = signal(1);

  /** Estados disponibles para el filtro (value interno → label capitalizado en UI). */
  protected readonly statusOptions = ['published', 'draft', 'hidden', 'disabled'];

  /** Estado de display de un salón (prioridad: disabled > hidden > status). */
  protected displayState(h: HallResponseDto): string {
    if (h.disabled) return 'disabled';
    if (h.hidden) return 'hidden';
    return h.status;
  }

  protected readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const st = this.statusFilter();
    return this.halls().filter((h) => {
      if (st && this.displayState(h) !== st) return false;
      if (!q) return true;
      return h.name.toLowerCase().includes(q) || (h.city ?? '').toLowerCase().includes(q);
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
    this.hallsApi.listAll().subscribe({
      next: (h) => this.halls.set(h),
      error: () => this.toasts.error(this.translate.instant('config.halls.loadError')),
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

  /**
   * Un salón es editable si está en borrador o desactivado (paridad con plantillas,
   * v3.10 · FE-3). Los salones no tienen concepto built-in.
   */
  protected canEditState(h: HallResponseDto): boolean {
    return h.status === 'draft' || h.disabled;
  }

  protected newHall(): void {
    void this.router.navigate(['/configuracion/salones/nuevo']);
  }
  protected editHall(h: HallResponseDto): void {
    if (!this.canEditState(h)) {
      this.toasts.warning(this.translate.instant('config.halls.editBlocked'));
      return;
    }
    void this.router.navigate(['/configuracion/salones', h.id, 'editar']);
  }

  // --- Publicar (con modal de confirmación, v3.9 · B3) ---
  protected askPublish(h: HallResponseDto): void {
    this.confirm.set({
      title: this.translate.instant('config.halls.publishConfirmTitle'),
      message: this.translate.instant('config.halls.publishConfirmMessage', { name: h.name }),
      confirmLabel: this.translate.instant('config.halls.publish'),
      confirmIcon: 'publish',
      titleIcon: 'publish',
      danger: false,
      auditAction: 'hall.publish',
      auditResource: h.id,
      onConfirm: () => this.publish(h),
    });
  }
  protected publish(h: HallResponseDto): void {
    this.hallsApi.publish(h.id).subscribe({
      next: () => {
        this.toasts.success(this.translate.instant('config.halls.published'));
        this.load();
      },
      error: () => this.toasts.error(this.translate.instant('config.halls.publishError')),
    });
  }
  protected unpublish(h: HallResponseDto): void {
    this.hallsApi.unpublish(h.id).subscribe({
      next: () => {
        this.toasts.info(this.translate.instant('config.halls.unpublished'));
        this.load();
      },
      error: () => this.toasts.error(this.translate.instant('config.halls.publishError')),
    });
  }

  // --- Transiciones de estado (ocultar/mostrar/deshabilitar/habilitar) ---
  private transition(obs: ReturnType<HallsApi['hide']>, msg: string): void {
    obs.subscribe({
      next: () => {
        this.toasts.success(this.translate.instant(msg));
        this.load();
      },
      error: () => this.toasts.error(this.translate.instant('config.halls.stateError')),
    });
  }
  protected hide(h: HallResponseDto): void {
    this.transition(this.hallsApi.hide(h.id), 'config.halls.hidden');
  }
  protected unhide(h: HallResponseDto): void {
    this.transition(this.hallsApi.unhide(h.id), 'config.halls.shown');
  }
  protected disable(h: HallResponseDto): void {
    this.transition(this.hallsApi.disable(h.id), 'config.halls.disabled');
  }
  protected enable(h: HallResponseDto): void {
    this.transition(this.hallsApi.enable(h.id), 'config.halls.enabled');
  }

  /** El botón Eliminar solo se habilita si el salón está deshabilitado. */
  protected canDelete(h: HallResponseDto): boolean {
    return h.disabled;
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
  protected askRemove(h: HallResponseDto): void {
    if (!this.canDelete(h)) {
      this.toasts.warning(this.translate.instant('config.halls.deleteBlocked'));
      return;
    }
    this.confirm.set({
      title: this.translate.instant('config.halls.removeConfirmTitle'),
      message: this.translate.instant('config.halls.removeConfirmMessage', { name: h.name }),
      confirmLabel: this.translate.instant('common.delete'),
      confirmIcon: 'delete',
      onConfirm: () =>
        this.hallsApi.remove(h.id).subscribe({
          next: () => {
            this.toasts.info(this.translate.instant('config.halls.removed'));
            this.load();
          },
          error: () => this.toasts.error(this.translate.instant('config.halls.removeError')),
        }),
    });
  }
}
