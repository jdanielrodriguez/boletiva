import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Router, RouterLink } from '@angular/router';
import { LocalizedDatePipe } from '../../core/i18n/localized-date.pipe';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { SessionStore } from '../../core/auth/session.store';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmController } from '../../shared/confirm-dialog/confirm-controller';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { PagerComponent } from '../../shared/ui/pager.component';
import { SearchFieldComponent } from '../../shared/ui/search-field.component';
import { StatusLabelPipe } from '../../shared/ui/status-label.pipe';
import { TourComponent, TourStep } from '../../shared/tour/tour.component';
import type { MyEventListItemDto } from '../../core/api/types';

const PAGE_SIZE = 9;

/**
 * Grupos de filtrado por estado (W8). Default = `upcoming` (futuros): oculta los que
 * están en curso, suspendidos y pasados. `ongoing` = publicados ocurriendo ahora
 * (startsAt ≤ ahora ≤ endsAt). `past` agrupa finished/cancelled y los concluidos por
 * fecha. `all` no filtra.
 */
type EventFilterGroup = 'upcoming' | 'ongoing' | 'suspended' | 'past' | 'all';

/**
 * Panel del promotor (F4/v3): gestiona SUS eventos en un grid de cards paginado.
 * Crear evento (borrador) + acciones por card (Publicar/Editar/Eliminar/Cancelar).
 * La edición profunda (localidades, asientos, banner, config, cuentas) vive en la
 * vista aparte `/promotor/eventos/:id/editar`. Invitar promotores = solo admin.
 */
@Component({
  selector: 'app-promoter-panel',
  imports: [FormsModule, LocalizedDatePipe, TranslatePipe, RouterLink, IconComponent, ConfirmDialogComponent, PagerComponent, StatusLabelPipe, SearchFieldComponent, TourComponent],
  templateUrl: './promoter-panel.html',
})
export class PromoterPanel {
  private readonly eventsApi = inject(PromoterEventsApi);
  private readonly session = inject(SessionStore);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  /** Promotor de PRUEBA → sus eventos van por Sandbox; se marcan con un chip TEST. */
  protected readonly isTestUser = computed(() => this.session.user()?.isTestUser === true);

  /** Tour de onboarding del panel del promotor. */
  protected readonly tourSteps: TourStep[] = [
    { title: 'tour.promoter.welcomeTitle', body: 'tour.promoter.welcomeBody' },
    { title: 'tour.promoter.createTitle', body: 'tour.promoter.createBody' },
    { title: 'tour.promoter.salesTitle', body: 'tour.promoter.salesBody' },
  ];

  protected readonly events = signal<MyEventListItemDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly page = signal(1);
  protected readonly pageSize = PAGE_SIZE;
  /** Búsqueda por nombre + filtro por estado (regla v3.2: toda lista los tiene). */
  protected readonly search = signal('');
  /** Filtro por grupo de estado (W8). Default = futuros. */
  protected readonly filterGroup = signal<EventFilterGroup>('upcoming');
  /** Opciones FIJAS del filtro (label vía i18n). */
  protected readonly filterOptions: { value: EventFilterGroup; key: string }[] = [
    { value: 'upcoming', key: 'promoter.panel.filterUpcoming' },
    { value: 'ongoing', key: 'promoter.panel.filterOngoing' },
    { value: 'suspended', key: 'promoter.panel.filterSuspended' },
    { value: 'past', key: 'promoter.panel.filterPast' },
    { value: 'all', key: 'promoter.panel.filterAll' },
  ];

  /** Clasifica un evento en su grupo de filtro (por estado y fechas). */
  private groupOf(e: MyEventListItemDto): EventFilterGroup {
    if (e.status === 'suspended') return 'suspended';
    if (e.status === 'finished' || e.status === 'cancelled') return 'past';
    const now = Date.now();
    const starts = new Date(e.startsAt).getTime();
    const ends = new Date(e.endsAt).getTime();
    // draft/published: "pasado" si ya concluyó por fecha.
    if (!Number.isNaN(ends) && ends < now) return 'past';
    // "En curso": publicado ocurriendo ahora (startsAt ≤ ahora ≤ endsAt).
    if (
      e.status === 'published' &&
      !Number.isNaN(starts) &&
      starts <= now &&
      (Number.isNaN(ends) || ends >= now)
    ) {
      return 'ongoing';
    }
    return 'upcoming';
  }

  /** Eventos tras aplicar búsqueda (nombre) + filtro de grupo de estado. */
  protected readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const group = this.filterGroup();
    return this.events().filter((e) => {
      if (group !== 'all' && this.groupOf(e) !== group) return false;
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
        this.toasts.error(this.translate.instant('promoter.panel.loadError'));
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

  /** Pide confirmación (modal) antes de publicar el evento. */
  protected askPublish(ev: MyEventListItemDto): void {
    this.confirm.ask({
      title: this.translate.instant('promoter.panel.publish'),
      message: this.translate.instant('promoter.panel.confirmPublishMsg', { name: ev.name }),
      confirmLabel: this.translate.instant('promoter.panel.publishShort'),
      confirmIcon: 'publish',
      onConfirm: () => this.publish(ev),
    });
  }

  protected publish(ev: MyEventListItemDto): void {
    this.eventsApi.publish(ev.id).subscribe({
      next: () => {
        this.toasts.success(this.translate.instant('promoter.panel.toastPublished', { name: ev.name }));
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
    return this.translate.instant('promoter.panel.publishErrorGeneric');
  }

  // --- Confirmación de acciones destructivas ---
  protected readonly confirm = new ConfirmController();

  protected askCancelEvent(ev: MyEventListItemDto): void {
    this.confirm.ask({
      title: this.translate.instant('promoter.panel.cancelTitle'),
      message: this.translate.instant('promoter.panel.confirmCancelMsg', { name: ev.name }),
      confirmLabel: this.translate.instant('promoter.panel.cancelTitle'),
      confirmIcon: 'cancel',
      onConfirm: () => this.cancelEvent(ev),
    });
  }

  protected cancelEvent(ev: MyEventListItemDto): void {
    this.eventsApi.cancel(ev.id).subscribe({
      next: () => {
        this.toasts.info(this.translate.instant('promoter.panel.toastCancelled', { name: ev.name }));
        this.loadEvents();
      },
      error: () => this.toasts.error(this.translate.instant('promoter.panel.cancelError')),
    });
  }

  protected askSuspend(ev: MyEventListItemDto): void {
    this.confirm.ask({
      title: this.translate.instant('promoter.panel.suspendTitle'),
      message: this.translate.instant('promoter.panel.confirmSuspendMsg', { name: ev.name }),
      confirmLabel: this.translate.instant('promoter.panel.suspendTitle'),
      confirmIcon: 'cancel',
      onConfirm: () => this.suspend(ev),
    });
  }

  protected suspend(ev: MyEventListItemDto): void {
    this.eventsApi.suspend(ev.id).subscribe({
      next: () => {
        this.toasts.info(this.translate.instant('promoter.panel.toastSuspended', { name: ev.name }));
        this.loadEvents();
      },
      error: () => this.toasts.error(this.translate.instant('promoter.panel.suspendError')),
    });
  }

  protected askRemove(ev: MyEventListItemDto): void {
    this.confirm.ask({
      title: this.translate.instant('promoter.panel.deleteTitle'),
      message: this.translate.instant('promoter.panel.confirmDeleteMsg', { name: ev.name }),
      onConfirm: () => this.remove(ev),
    });
  }

  protected remove(ev: MyEventListItemDto): void {
    this.eventsApi.remove(ev.id).subscribe({
      next: () => {
        this.toasts.success(this.translate.instant('promoter.panel.toastRemoved', { name: ev.name }));
        this.loadEvents();
      },
      error: () => this.toasts.error(this.translate.instant('promoter.panel.removeError')),
    });
  }
}
