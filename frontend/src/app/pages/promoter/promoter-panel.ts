import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { ToastService } from '../../core/ui/toast.service';
import {
  ConfirmDialogComponent,
  type ConfirmRequest,
} from '../../shared/confirm-dialog/confirm-dialog.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { PagerComponent } from '../../shared/ui/pager.component';
import type { MyEventListItemDto } from '../../core/api/types';

const PAGE_SIZE = 9;

/**
 * Panel del promotor (F4/v3): gestiona SUS eventos en un grid de cards paginado.
 * Crear evento (borrador) + acciones por card (Publicar/Editar/Eliminar/Cancelar).
 * La edición profunda (localidades, asientos, banner, config, cuentas) vive en la
 * vista aparte `/promotor/eventos/:id/editar`. Invitar promotores = solo admin.
 */
@Component({
  selector: 'app-promoter-panel',
  imports: [FormsModule, DatePipe, RouterLink, IconComponent, ConfirmDialogComponent, PagerComponent],
  templateUrl: './promoter-panel.html',
})
export class PromoterPanel {
  private readonly eventsApi = inject(PromoterEventsApi);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly events = signal<MyEventListItemDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly page = signal(1);
  protected readonly pageSize = PAGE_SIZE;
  /** Búsqueda por nombre + filtro por estado (regla v3.2: toda lista los tiene). */
  protected readonly search = signal('');
  protected readonly filterStatus = signal('');

  /** Estados presentes (para el selector de filtro). */
  protected readonly statuses = computed(() => [...new Set(this.events().map((e) => e.status))]);
  /** Eventos tras aplicar búsqueda (nombre) + filtro de estado. */
  protected readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const st = this.filterStatus();
    return this.events().filter((e) => {
      if (st && e.status !== st) return false;
      if (q && !e.name.toLowerCase().includes(q)) return false;
      return true;
    });
  });
  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.filtered().length / PAGE_SIZE)),
  );
  protected readonly pageEvents = computed(() => {
    const start = (Math.min(this.page(), this.totalPages()) - 1) * PAGE_SIZE;
    return this.filtered().slice(start, start + PAGE_SIZE);
  });
  protected readonly hasPrev = computed(() => this.page() > 1);
  protected readonly hasNext = computed(() => this.page() < this.totalPages());

  /** Al cambiar búsqueda/filtro vuelve a la página 1. */
  protected onFilterChange(): void {
    this.page.set(1);
  }

  constructor() {
    this.loadEvents();
  }

  private loadEvents(): void {
    this.loading.set(true);
    this.eventsApi.mine().subscribe({
      next: (e) => {
        this.events.set(e);
        this.loading.set(false);
        this.page.set(1);
      },
      error: () => {
        this.events.set([]);
        this.loading.set(false);
        this.toasts.error('No se pudieron cargar tus eventos.');
      },
    });
  }

  protected goToPage(p: number): void {
    this.page.set(Math.min(Math.max(1, p), this.totalPages()));
  }

  /** "Nuevo evento" abre la MISMA vista de edición en modo creación (form en blanco). */
  protected newEvent(): void {
    void this.router.navigate(['/promotor/eventos/nuevo']);
  }

  protected publish(ev: MyEventListItemDto): void {
    this.eventsApi.publish(ev.id).subscribe({
      next: () => {
        this.toasts.success(`"${ev.name}" publicado.`);
        this.loadEvents();
      },
      error: (err) => this.toasts.error(this.publishError(err)),
    });
  }

  /** Extrae el motivo (422 del backend: falta banner/asientos) o uno genérico. */
  private publishError(err: unknown): string {
    const msg = (err as { error?: { message?: string | string[] } })?.error?.message;
    if (Array.isArray(msg)) return msg.join(' ');
    if (typeof msg === 'string') return msg;
    return 'No se pudo publicar. Abre el evento para ver qué falta (banner/asientos).';
  }

  // --- Confirmación de acciones destructivas ---
  protected readonly confirm = signal<ConfirmRequest | null>(null);
  protected onConfirmAccept(): void {
    const c = this.confirm();
    this.confirm.set(null);
    c?.onConfirm();
  }
  protected onConfirmCancel(): void {
    this.confirm.set(null);
  }

  protected askCancelEvent(ev: MyEventListItemDto): void {
    this.confirm.set({
      title: 'Cancelar evento',
      message: `¿Seguro que deseas cancelar "${ev.name}"? Dejará de venderse.`,
      confirmLabel: 'Cancelar evento',
      confirmIcon: 'cancel',
      onConfirm: () => this.cancelEvent(ev),
    });
  }

  protected cancelEvent(ev: MyEventListItemDto): void {
    this.eventsApi.cancel(ev.id).subscribe({
      next: () => {
        this.toasts.info(`"${ev.name}" cancelado.`);
        this.loadEvents();
      },
      error: () => this.toasts.error('No se pudo cancelar el evento.'),
    });
  }

  protected askRemove(ev: MyEventListItemDto): void {
    this.confirm.set({
      title: 'Eliminar evento',
      message: `¿Seguro que deseas eliminar "${ev.name}"? Esta acción no se puede deshacer.`,
      onConfirm: () => this.remove(ev),
    });
  }

  protected remove(ev: MyEventListItemDto): void {
    this.eventsApi.remove(ev.id).subscribe({
      next: () => {
        this.toasts.success(`"${ev.name}" eliminado.`);
        this.loadEvents();
      },
      error: () => this.toasts.error('Solo puedes eliminar eventos en borrador.'),
    });
  }
}
