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
import { BackLinkComponent } from '../../shared/ui/back-link.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { PagerComponent } from '../../shared/ui/pager.component';
import { StatusLabelPipe } from '../../shared/ui/status-label.pipe';
import type { HallResponseDto } from '../../core/api/types';

const PAGE = 9;

type HallsTab = 'list' | 'dashboard';

/**
 * Página de gestión de SALONES (v3.8 · G2, solo admin). SOLO la lista con filtros
 * (buscador + estado) y paginación; la creación/edición vive en una página aparte
 * (`hall-edit.page`) a la que navegan los botones "Nuevo salón"/"Editar". Dos
 * pestañas: Lista (contenido actual) y Dashboard (placeholder "próximamente"). Al
 * cambiar de pestaña se resetean los filtros. Estados: los PUBLICADOS solo se
 * despublican; los BORRADORES se publican, editan y eliminan.
 */
@Component({
  selector: 'app-halls-page',
  imports: [
    FormsModule,
    TranslatePipe,
    StatusLabelPipe,
    IconComponent,
    ConfirmDialogComponent,
    PagerComponent,
    BackLinkComponent,
    EmptyStateComponent,
  ],
  templateUrl: './halls.page.html',
})
export class HallsPage {
  private readonly hallsApi = inject(HallsApi);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);

  protected readonly halls = signal<HallResponseDto[]>([]);
  protected readonly search = signal('');
  protected readonly statusFilter = signal<string>('');
  protected readonly page = signal(1);
  protected readonly tab = signal<HallsTab>('list');

  /** Estados disponibles para el filtro (value interno → label capitalizado en UI). */
  protected readonly statusOptions = ['published', 'draft'];

  protected readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const st = this.statusFilter();
    return this.halls().filter((h) => {
      if (st && h.status !== st) return false;
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

  protected setTab(t: HallsTab): void {
    this.tab.set(t);
    // Regla transversal v3.8: al cambiar de pestaña se resetean los filtros.
    this.search.set('');
    this.statusFilter.set('');
    this.page.set(1);
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

  protected newHall(): void {
    void this.router.navigate(['/configuracion/salones/nuevo']);
  }
  protected editHall(h: HallResponseDto): void {
    void this.router.navigate(['/configuracion/salones', h.id, 'editar']);
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
