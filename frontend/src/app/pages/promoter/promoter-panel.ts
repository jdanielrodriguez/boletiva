import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { ToastService } from '../../core/ui/toast.service';
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
  imports: [FormsModule, DatePipe, RouterLink],
  templateUrl: './promoter-panel.html',
})
export class PromoterPanel {
  private readonly eventsApi = inject(PromoterEventsApi);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly events = signal<MyEventListItemDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly creating = signal(false);
  protected readonly showCreate = signal(false);
  protected readonly page = signal(1);
  protected readonly pageSize = PAGE_SIZE;

  // Crear = borrador mínimo (solo nombre + inicio); el resto se completa en el
  // editor (misma vista de alta/edición). El fin se autocalcula en el backend.
  protected readonly form = {
    name: signal(''),
    startsAt: signal(''),
  };

  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.events().length / PAGE_SIZE)),
  );
  protected readonly pageEvents = computed(() => {
    const start = (this.page() - 1) * PAGE_SIZE;
    return this.events().slice(start, start + PAGE_SIZE);
  });
  protected readonly hasPrev = computed(() => this.page() > 1);
  protected readonly hasNext = computed(() => this.page() < this.totalPages());

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

  protected toggleCreate(): void {
    this.showCreate.update((v) => !v);
  }

  protected goToPage(p: number): void {
    this.page.set(Math.min(Math.max(1, p), this.totalPages()));
  }

  /**
   * Crea un BORRADOR mínimo y navega a la vista de edición (única vista de
   * alta/edición). El fin es opcional: el backend lo autocalcula (inicio + 12h).
   */
  protected createEvent(): void {
    if (!this.form.name() || !this.form.startsAt()) {
      this.toasts.warning('Completa el nombre y la fecha de inicio del evento.');
      return;
    }
    this.creating.set(true);
    this.eventsApi
      .create({
        name: this.form.name(),
        startsAt: new Date(this.form.startsAt()).toISOString(),
        ivaOnNet: true,
        absorbInstallmentCost: false,
      })
      .subscribe({
        next: (ev) => {
          this.creating.set(false);
          this.form.name.set('');
          this.form.startsAt.set('');
          this.showCreate.set(false);
          this.toasts.success('Borrador creado. Completa los datos y publícalo.');
          void this.router.navigate(['/promotor/eventos', ev.id, 'editar']);
        },
        error: () => {
          this.creating.set(false);
          this.toasts.error('No se pudo crear el evento. Revisa la fecha de inicio.');
        },
      });
  }

  protected publish(ev: MyEventListItemDto): void {
    this.eventsApi.publish(ev.id).subscribe({
      next: () => {
        this.toasts.success(`"${ev.name}" publicado.`);
        this.loadEvents();
      },
      error: () => this.toasts.error('No se pudo publicar (¿faltan localidades?).'),
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
