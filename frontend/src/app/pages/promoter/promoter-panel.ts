import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CategoriesApi } from '../../core/api/categories.api';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { ToastService } from '../../core/ui/toast.service';
import type { CategoryResponseDto, MyEventListItemDto } from '../../core/api/types';

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
  private readonly categoriesApi = inject(CategoriesApi);
  private readonly toasts = inject(ToastService);

  protected readonly events = signal<MyEventListItemDto[]>([]);
  protected readonly categories = signal<CategoryResponseDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly creating = signal(false);
  protected readonly showCreate = signal(false);
  protected readonly page = signal(1);
  protected readonly pageSize = PAGE_SIZE;

  protected readonly form = {
    name: signal(''),
    categoryId: signal(''),
    startsAt: signal(''),
    endsAt: signal(''),
    description: signal(''),
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
    this.categoriesApi.list().subscribe({ next: (c) => this.categories.set(c), error: () => undefined });
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

  protected createEvent(): void {
    if (!this.form.name() || !this.form.startsAt() || !this.form.endsAt()) {
      this.toasts.warning('Completa nombre y fechas del evento.');
      return;
    }
    this.creating.set(true);
    this.eventsApi
      .create({
        name: this.form.name(),
        startsAt: new Date(this.form.startsAt()).toISOString(),
        endsAt: new Date(this.form.endsAt()).toISOString(),
        categoryId: this.form.categoryId() || undefined,
        description: this.form.description() || undefined,
        ivaOnNet: true,
        absorbInstallmentCost: false,
      })
      .subscribe({
        next: () => {
          this.creating.set(false);
          this.form.name.set('');
          this.form.description.set('');
          this.form.startsAt.set('');
          this.form.endsAt.set('');
          this.showCreate.set(false);
          this.toasts.success('Evento creado en borrador. Configúralo y publícalo.');
          this.loadEvents();
        },
        error: () => {
          this.creating.set(false);
          this.toasts.error('No se pudo crear el evento. Revisa las fechas.');
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
