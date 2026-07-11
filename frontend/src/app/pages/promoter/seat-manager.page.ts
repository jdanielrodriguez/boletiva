import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ActivatedRoute } from '@angular/router';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { EditUnlockStore } from '../../core/events/edit-unlock.store';
import { SessionStore } from '../../core/auth/session.store';
import { IconComponent } from '../../shared/icon/icon.component';
import { BackLinkComponent } from '../../shared/ui/back-link.component';
import { SeatEditorComponent } from './seat-editor.component';
import type { LocalityView, ManagedEventDetailDto } from '../../core/api/types';

/**
 * Editor de asientos a PÁGINA COMPLETA (ruta aparte, v3.3): renderiza el
 * `app-seat-editor` (Konva) para una localidad `seated` concreta. Igual que el
 * editor de evento es una vista propia, administrar asientos también lo es (no un
 * desplegable inline). El encabezado vuelve al editor del evento en la pestaña
 * Localidades, preservando `?from=admin` si se venía como admin.
 */
@Component({
  selector: 'app-seat-manager',
  imports: [SeatEditorComponent, IconComponent, TranslatePipe, BackLinkComponent],
  templateUrl: './seat-manager.page.html',
})
export class SeatManagerPage implements OnDestroy {
  private readonly api = inject(PromoterEventsApi);
  private readonly editUnlock = inject(EditUnlockStore);
  private readonly session = inject(SessionStore);
  private readonly route = inject(ActivatedRoute);

  protected readonly eventId = signal(this.route.snapshot.paramMap.get('eventId') ?? '');
  protected readonly localityId = signal(this.route.snapshot.paramMap.get('localityId') ?? '');
  protected readonly from = signal(this.route.snapshot.queryParamMap.get('from') ?? '');

  protected readonly event = signal<ManagedEventDetailDto | null>(null);
  protected readonly locality = signal<LocalityView | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);

  /**
   * Bloqueado cuando el usuario es ADMIN y NO es el dueño del evento, sin
   * desbloqueo vigente (persiste entre vistas). Se determina por propiedad real,
   * no por ?from=admin. El dueño (promotor o admin dueño) nunca se bloquea.
   */
  protected readonly adminLocked = computed(() => {
    const ev = this.event();
    const uid = this.session.user()?.id;
    return (
      this.session.hasRole('admin') &&
      !!ev &&
      !!uid &&
      ev.promoterId !== uid &&
      !this.editUnlock.isUnlocked(this.eventId())
    );
  });
  /** Publicado o bloqueado por admin → asientos solo lectura; el backend también valida. */
  protected readonly readonly = computed(
    () => (this.event()?.status ?? 'draft') !== 'draft' || this.adminLocked(),
  );

  /** Vuelve al editor del evento (pestaña Localidades), preservando el origen. */
  protected readonly backLink = computed(() => `/promotor/eventos/${this.eventId()}/editar`);
  protected readonly backQuery = computed(() =>
    this.from() === 'admin' ? { tab: 'localidades', from: 'admin' } : { tab: 'localidades' },
  );

  constructor() {
    // Mantiene el contexto para el interceptor (x-edit-unlock) al entrar a asientos.
    this.editUnlock.setCurrentEvent(this.eventId());
    this.api.get(this.eventId()).subscribe({
      next: (ev) => {
        this.event.set(ev);
        this.loading.set(false);
      },
      error: () => {
        this.notFound.set(true);
        this.loading.set(false);
      },
    });
    this.api.localities(this.eventId()).subscribe({
      next: (list) => this.locality.set(list.find((l) => l.id === this.localityId()) ?? null),
      error: () => this.locality.set(null),
    });
  }

  ngOnDestroy(): void {
    this.editUnlock.clearCurrentEvent();
  }
}
