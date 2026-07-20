import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AdminApi, PromoterHistoryItemDto } from '../../core/api/admin.api';
import { LocalizedDatePipe } from '../../core/i18n/localized-date.pipe';
import { MoneyPipe } from '../../shared/money.pipe';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { BackLinkComponent } from '../../shared/ui/back-link.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { LoadingComponent } from '../../shared/ui/loading.component';
import { SearchFieldComponent } from '../../shared/ui/search-field.component';


/**
 * Historial de estados de un promotor en PÁGINA dedicada (v3.6, roleGuard admin).
 * Lee `promoter_status_events` vía `GET /promoters/:id/history` y permite
 * revisar/buscar/filtrar/ordenar las transiciones (fecha, admin que ejecutó,
 * de→a, motivo). Se llega desde la consola (tab Promotores → "Historial") y
 * vuelve a ella con el botón de regreso.
 */
@Component({
  selector: 'app-promoter-history-page',
  imports: [
    FormsModule,
    TranslatePipe,
    LocalizedDatePipe,
    MoneyPipe,
    IconComponent,
    BackLinkComponent,
    EmptyStateComponent,
    LoadingComponent,
    SearchFieldComponent,
  ],
  templateUrl: './promoter-history.page.html',
})
export class PromoterHistoryPage {
  private readonly admin = inject(AdminApi);
  private readonly route = inject(ActivatedRoute);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);

  /** Nombre del promotor (viene por query param desde la consola; opcional). */
  protected readonly promoterName = signal<string>(
    this.route.snapshot.queryParamMap.get('name') ?? '',
  );
  protected readonly loading = signal(true);
  protected readonly events = signal<PromoterHistoryItemDto[]>([]);

  /** Búsqueda libre (por motivo o estado). */
  protected readonly search = signal('');
  /** Filtro por estado destino ('' = todos). */
  protected readonly statusFilter = signal<string>('');
  /** Orden por fecha (desc por defecto = lo más reciente arriba). */
  protected readonly sortDesc = signal(true);

  /** Estados destino presentes en el historial (para el selector de filtro). */
  protected readonly availableStatuses = computed(() =>
    [...new Set(this.events().map((e) => e.statusTo).filter((s): s is string => !!s))].sort(),
  );

  protected readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const st = this.statusFilter();
    const list = this.events().filter((e) => {
      if (st && e.statusTo !== st) return false;
      if (!q) return true;
      const hay =
        `${e.statusFrom ?? ''} ${e.statusTo ?? ''} ${e.reason ?? ''} ${e.eventName ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
    const dir = this.sortDesc() ? -1 : 1;
    return [...list].sort(
      (a, b) => dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    );
  });

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.loading.set(false);
      return;
    }
    this.admin.promoterHistory(id).subscribe({
      next: (h) => {
        this.events.set(h);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toasts.error(this.translate.instant('config.promoters.historyError'));
      },
    });
  }

  protected toggleSort(): void {
    this.sortDesc.update((v) => !v);
  }

  protected statusLabel(s: string | null): string {
    return s ? this.translate.instant('promoterHistory.status.' + s) : '';
  }
}
