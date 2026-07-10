import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { CategoriesApi } from '../../core/api/categories.api';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { ToastService } from '../../core/ui/toast.service';
import { EventSettlementComponent } from '../../shared/event-settlement/event-settlement.component';
import { SeatEditorComponent } from './seat-editor.component';
import type {
  CategoryResponseDto,
  GatewayResponseDto,
  LocalityView,
  ManagedEventDetailDto,
  PriceQuoteResponseDto,
} from '../../core/api/types';

type Tab = 'datos' | 'localidades' | 'banner' | 'config' | 'cuentas' | 'dashboard';
type BannerTemplate = 'aurora' | 'midnight' | 'sunset' | 'forest' | 'mono';

/** Convierte ISO a valor de <input datetime-local> (YYYY-MM-DDTHH:mm, hora local). */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Vista de edición de un evento (ruta aparte, F-v3). Secciones: datos, localidades
 * (con editor de asientos), banner con IA (plantilla + prompt + imágenes de
 * ejemplo), configuración (pasarela/IVA/cuotas) y cuentas del evento. Una vez
 * PUBLICADO, las localidades quedan bloqueadas y no se cambia pasarela/IVA (el
 * backend lo valida; aquí se refleja en la UI).
 */
@Component({
  selector: 'app-event-edit',
  imports: [FormsModule, RouterLink, EventSettlementComponent, SeatEditorComponent],
  templateUrl: './event-edit.page.html',
})
export class EventEditPage {
  private readonly api = inject(PromoterEventsApi);
  private readonly categoriesApi = inject(CategoriesApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly templates: BannerTemplate[] = ['aurora', 'midnight', 'sunset', 'forest', 'mono'];

  protected readonly eventId = signal<string>(this.route.snapshot.paramMap.get('id') ?? '');
  protected readonly event = signal<ManagedEventDetailDto | null>(null);
  protected readonly categories = signal<CategoryResponseDto[]>([]);
  protected readonly gateways = signal<GatewayResponseDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly tab = signal<Tab>('datos');
  protected readonly savingData = signal(false);
  protected readonly savingConfig = signal(false);

  protected readonly isPublished = computed(() => (this.event()?.status ?? 'draft') !== 'draft');
  protected readonly isFrozen = computed(() => !!this.event()?.frozenGatewayId);

  /** Origen de navegación: 'admin' vuelve a /configuracion; si no, a /promotor. */
  protected readonly from = signal<string>(this.route.snapshot.queryParamMap.get('from') ?? '');
  protected readonly backLink = computed(() =>
    this.from() === 'admin' ? '/configuracion' : '/promotor',
  );
  protected readonly backLabel = computed(() =>
    this.from() === 'admin' ? '← Volver a la consola' : '← Volver a mis eventos',
  );

  // Datos (sin fin: el backend lo autocalcula = inicio + 12h; se puede ajustar
  // vía API pero la UI del promotor solo pide el inicio).
  protected readonly d = {
    name: signal(''),
    description: signal(''),
    categoryId: signal(''),
    address: signal(''),
    startsAt: signal(''),
  };
  // Config
  protected readonly c = {
    gatewayId: signal(''),
    ivaOnNet: signal(true),
    absorbInstallmentCost: signal(false),
  };

  // Localidades
  protected readonly localities = signal<LocalityView[]>([]);
  protected readonly editingSeatsFor = signal<string | null>(null);
  protected readonly locForm = {
    name: signal(''),
    kind: signal<'seated' | 'general'>('general'),
    capacity: signal<number | null>(null),
    desiredNet: signal<number | null>(null),
  };

  // Preview de precio (debounced 300ms) al teclear el neto de una localidad.
  private readonly netInput$ = new Subject<number>();
  protected readonly pricePreview = signal<PriceQuoteResponseDto | null>(null);
  protected readonly previewLoading = signal(false);

  // Banner
  protected readonly banner = {
    template: signal<BannerTemplate>('aurora'),
    prompt: signal(''),
    sampleImages: signal(''),
  };
  protected readonly bannerUrl = signal<string | null>(null);
  protected readonly generatingBanner = signal(false);

  constructor() {
    this.categoriesApi.list().subscribe({ next: (c) => this.categories.set(c), error: () => undefined });
    this.api.activeGateways().subscribe({ next: (g) => this.gateways.set(g), error: () => undefined });

    // Tab inicial desde el query param (?tab=cuentas) — usado por la consola admin.
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (tab && ['datos', 'localidades', 'banner', 'config', 'cuentas', 'dashboard'].includes(tab)) {
      this.tab.set(tab as Tab);
    }

    // Preview de precio server-authoritative con DEBOUNCE (evita DDoS del endpoint
    // de cotización al teclear). Cada neto válido cotiza y muestra el desglose.
    this.netInput$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((net) => {
          this.previewLoading.set(true);
          return this.api.quote(net);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          this.pricePreview.set(res.quote);
          this.previewLoading.set(false);
        },
        error: () => {
          this.pricePreview.set(null);
          this.previewLoading.set(false);
        },
      });

    this.reload();
  }

  /** Al teclear el neto de una localidad: actualiza el modelo y dispara el preview. */
  protected onNetChange(value: number | null): void {
    this.locForm.desiredNet.set(value);
    if (value != null && value > 0) {
      this.netInput$.next(value);
    } else {
      this.pricePreview.set(null);
    }
  }

  private reload(): void {
    this.loading.set(true);
    this.api.get(this.eventId()).subscribe({
      next: (ev) => {
        this.event.set(ev);
        this.hydrate(ev);
        this.loading.set(false);
        this.loadLocalities();
      },
      error: () => {
        this.notFound.set(true);
        this.loading.set(false);
      },
    });
  }

  private hydrate(ev: ManagedEventDetailDto): void {
    this.d.name.set(ev.name);
    this.d.description.set(ev.description ?? '');
    this.d.categoryId.set(ev.categoryId ?? '');
    this.d.address.set(ev.address ?? '');
    this.d.startsAt.set(toLocalInput(ev.startsAt));
    this.c.gatewayId.set(ev.gatewayId ?? '');
    this.c.ivaOnNet.set(ev.ivaOnNet);
    this.c.absorbInstallmentCost.set(ev.absorbInstallmentCost);
    this.bannerUrl.set(ev.media?.find((m) => m.kind === 'cover')?.url ?? null);
  }

  protected selectTab(t: Tab): void {
    this.tab.set(t);
  }

  // --- Datos / Guardar borrador ---
  // El fin se OMITE (endsAt opcional): el backend conserva/autocalcula. Sirve como
  // "Guardar borrador": persiste los cambios del draft sin publicar.
  protected saveData(): void {
    this.savingData.set(true);
    this.api
      .update(this.eventId(), {
        name: this.d.name(),
        description: this.d.description() || undefined,
        categoryId: this.d.categoryId() || undefined,
        address: this.d.address() || undefined,
        startsAt: this.d.startsAt() ? new Date(this.d.startsAt()).toISOString() : undefined,
        // Preserva la config actual (el contrato UpdateEventDto los exige).
        ivaOnNet: this.c.ivaOnNet(),
        absorbInstallmentCost: this.c.absorbInstallmentCost(),
      })
      .subscribe({
        next: (ev) => {
          this.savingData.set(false);
          this.event.set(ev);
          this.toasts.success('Borrador guardado.');
        },
        error: () => {
          this.savingData.set(false);
          this.toasts.error('No se pudieron guardar los datos (revisa la fecha de inicio).');
        },
      });
  }

  // --- Configuración ---
  protected saveConfig(): void {
    this.savingConfig.set(true);
    this.api
      .update(this.eventId(), {
        gatewayId: this.c.gatewayId() || undefined,
        ivaOnNet: this.c.ivaOnNet(),
        absorbInstallmentCost: this.c.absorbInstallmentCost(),
      })
      .subscribe({
        next: (ev) => {
          this.savingConfig.set(false);
          this.event.set(ev);
          this.toasts.success('Configuración guardada.');
        },
        error: () => {
          this.savingConfig.set(false);
          this.toasts.error('No se pudo guardar; el evento con compras congela pasarela e IVA.');
        },
      });
  }

  // --- Localidades ---
  private loadLocalities(): void {
    this.api.localities(this.eventId()).subscribe({
      next: (l) => this.localities.set(l),
      error: () => this.localities.set([]),
    });
  }

  /** El editor de asientos cambió el aforo → refresca la lista de localidades. */
  protected loadLocalitiesPublic(): void {
    this.loadLocalities();
  }

  protected addLocality(): void {
    if (!this.locForm.name()) {
      this.toasts.warning('La localidad necesita un nombre.');
      return;
    }
    const kind = this.locForm.kind();
    this.api
      .addLocality(this.eventId(), {
        name: this.locForm.name(),
        kind,
        capacity: kind === 'general' ? this.locForm.capacity() ?? undefined : undefined,
        desiredNet: this.locForm.desiredNet() ?? undefined,
      })
      .subscribe({
        next: () => {
          this.locForm.name.set('');
          this.locForm.capacity.set(null);
          this.locForm.desiredNet.set(null);
          this.pricePreview.set(null);
          this.toasts.success('Localidad agregada.');
          this.loadLocalities();
        },
        error: () => this.toasts.error('No se pudo agregar la localidad (¿evento publicado?).'),
      });
  }

  protected removeLocality(l: LocalityView): void {
    this.api.removeLocality(l.id).subscribe({
      next: () => {
        this.toasts.info('Localidad eliminada.');
        this.loadLocalities();
      },
      error: () => this.toasts.error('No se pudo eliminar (¿evento publicado?).'),
    });
  }

  protected toggleSeats(l: LocalityView): void {
    this.editingSeatsFor.set(this.editingSeatsFor() === l.id ? null : l.id);
  }

  // --- Banner ---
  protected generateBanner(): void {
    this.generatingBanner.set(true);
    const images = this.banner
      .sampleImages()
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    this.api
      .generateBanner(this.eventId(), {
        template: this.banner.template(),
        prompt: this.banner.prompt() || undefined,
        sampleImages: images.length ? images : undefined,
      })
      .subscribe({
        next: (b) => {
          this.generatingBanner.set(false);
          this.bannerUrl.set(b.url);
          this.toasts.success('Banner generado.');
        },
        error: () => {
          this.generatingBanner.set(false);
          this.toasts.error('No se pudo generar el banner.');
        },
      });
  }

  // --- Acciones de estado ---
  protected publish(): void {
    this.api.publish(this.eventId()).subscribe({
      next: (ev) => {
        this.event.set(ev);
        this.toasts.success('Evento publicado.');
      },
      error: () => this.toasts.error('No se pudo publicar (¿faltan localidades?).'),
    });
  }

  protected cancelEvent(): void {
    this.api.cancel(this.eventId()).subscribe({
      next: (ev) => {
        this.event.set(ev);
        this.toasts.info('Evento cancelado.');
      },
      error: () => this.toasts.error('No se pudo cancelar el evento.'),
    });
  }

  protected remove(): void {
    this.api.remove(this.eventId()).subscribe({
      next: () => {
        this.toasts.success('Evento eliminado.');
        void this.router.navigateByUrl(this.backLink());
      },
      error: () => this.toasts.error('Solo puedes eliminar eventos en borrador.'),
    });
  }
}
