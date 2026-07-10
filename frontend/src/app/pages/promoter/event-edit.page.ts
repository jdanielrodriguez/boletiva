import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { CategoriesApi } from '../../core/api/categories.api';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { MediaApi } from '../../core/api/media.api';
import { ToastService } from '../../core/ui/toast.service';
import {
  ConfirmDialogComponent,
  type ConfirmRequest,
} from '../../shared/confirm-dialog/confirm-dialog.component';
import { EventSettlementComponent } from '../../shared/event-settlement/event-settlement.component';
import { IconComponent } from '../../shared/icon/icon.component';
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
 * Vista de alta/edición de un evento (ruta aparte, F-v3). MISMA página en dos
 * modos: `nuevo` (formulario en blanco; el evento se crea al primer Guardar) y
 * edición (con id). Secciones: datos, localidades (con editor de asientos), banner
 * (subir uno ya hecho o generarlo con IA), configuración y cuentas. Publicar está
 * DESHABILITADO hasta guardar y hasta cumplir el gate (banner + asientos en las
 * localidades con mapa). Publicado → localidades bloqueadas y pasarela/IVA fijos.
 */
@Component({
  selector: 'app-event-edit',
  imports: [FormsModule, RouterLink, EventSettlementComponent, IconComponent, ConfirmDialogComponent],
  templateUrl: './event-edit.page.html',
})
export class EventEditPage {
  private readonly api = inject(PromoterEventsApi);
  private readonly media = inject(MediaApi);
  private readonly categoriesApi = inject(CategoriesApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly bannerTemplates: BannerTemplate[] = ['aurora', 'midnight', 'sunset', 'forest', 'mono'];

  protected readonly eventId = signal<string>(this.route.snapshot.paramMap.get('id') ?? '');
  /** Modo creación: sin id en la ruta (/promotor/eventos/nuevo). */
  protected readonly isNew = signal<boolean>(!this.route.snapshot.paramMap.get('id'));
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

  // Datos
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
  protected readonly locSearchOpen = signal(false);
  protected readonly locSearch = signal('');
  /** Form de "crear localidad" plegado por defecto (patrón botón→form). */
  protected readonly showLocForm = signal(false);
  protected readonly filteredLocalities = computed(() => {
    const q = this.locSearch().trim().toLowerCase();
    if (!q) return this.localities();
    return this.localities().filter((l) => l.name.toLowerCase().includes(q));
  });
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

  // Banner: subir uno ya hecho o generar con IA (form de IA plegado tras el desplegable).
  protected readonly banner = {
    template: signal<BannerTemplate>('aurora'),
    prompt: signal(''),
    sampleImages: signal(''),
  };
  protected readonly bannerUrl = signal<string | null>(null);
  protected readonly generatingBanner = signal(false);
  protected readonly uploadingBanner = signal(false);
  /** El form de IA no está siempre visible: se abre desde el desplegable. */
  protected readonly showAiForm = signal(false);

  /** ¿Hay banner? (media cover o uno recién subido/generado). */
  protected readonly hasBanner = computed(() => !!this.bannerUrl());

  /**
   * Motivo por el que NO se puede publicar (o null si sí). Refleja el gate del
   * backend: evento guardado + banner + toda localidad seated con asientos.
   */
  protected readonly publishBlock = computed<string | null>(() => {
    if (this.isNew() || !this.event()) return 'Guarda el evento antes de publicar.';
    if (this.localities().length === 0) return 'Agrega al menos una localidad.';
    if (!this.hasBanner()) return 'Agrega un banner (imagen) del evento.';
    const emptySeated = this.localities().find(
      (l) => l.kind === 'seated' && (l.capacity ?? 0) === 0,
    );
    if (emptySeated) return `La localidad "${emptySeated.name}" no tiene asientos colocados.`;
    return null;
  });
  protected readonly canPublish = computed(() => this.publishBlock() === null);

  // Confirmación de acciones destructivas (modal reutilizable).
  protected readonly confirm = signal<ConfirmRequest | null>(null);
  protected onConfirmAccept(): void {
    const c = this.confirm();
    this.confirm.set(null);
    c?.onConfirm();
  }
  protected onConfirmCancel(): void {
    this.confirm.set(null);
  }

  constructor() {
    this.categoriesApi.list().subscribe({ next: (c) => this.categories.set(c), error: () => undefined });
    this.api.activeGateways().subscribe({ next: (g) => this.gateways.set(g), error: () => undefined });

    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (tab && ['datos', 'localidades', 'banner', 'config', 'cuentas', 'dashboard'].includes(tab)) {
      this.tab.set(tab as Tab);
    }

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

    if (this.isNew()) {
      // Modo NUEVO: formulario en blanco; el evento aún no existe.
      this.loading.set(false);
    } else {
      this.reload();
    }
  }

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

  // --- Datos / Guardar (crea en modo nuevo; actualiza en edición) ---
  protected saveData(): void {
    if (!this.d.name() || this.d.name().trim().length < 3) {
      this.toasts.warning('El evento necesita un nombre (mínimo 3 caracteres).');
      return;
    }
    if (this.isNew() && !this.d.startsAt()) {
      this.toasts.warning('Indica la fecha y hora de inicio.');
      return;
    }
    this.savingData.set(true);
    if (this.isNew()) {
      this.api
        .create({
          name: this.d.name(),
          description: this.d.description() || undefined,
          categoryId: this.d.categoryId() || undefined,
          address: this.d.address() || undefined,
          startsAt: new Date(this.d.startsAt()).toISOString(),
          ivaOnNet: this.c.ivaOnNet(),
          absorbInstallmentCost: this.c.absorbInstallmentCost(),
        })
        .subscribe({
          next: (ev) => {
            this.savingData.set(false);
            this.toasts.success('Evento creado. Completa localidades, banner y publícalo.');
            // Pasa a modo edición reemplazando la URL por la del evento real.
            void this.router.navigate(['/promotor/eventos', ev.id, 'editar'], {
              replaceUrl: true,
              queryParams: this.from() === 'admin' ? { from: 'admin' } : {},
            });
          },
          error: () => {
            this.savingData.set(false);
            this.toasts.error('No se pudo crear el evento (revisa nombre y fecha de inicio).');
          },
        });
      return;
    }
    this.api
      .update(this.eventId(), {
        name: this.d.name(),
        description: this.d.description() || undefined,
        categoryId: this.d.categoryId() || undefined,
        address: this.d.address() || undefined,
        startsAt: this.d.startsAt() ? new Date(this.d.startsAt()).toISOString() : undefined,
        ivaOnNet: this.c.ivaOnNet(),
        absorbInstallmentCost: this.c.absorbInstallmentCost(),
      })
      .subscribe({
        next: (ev) => {
          this.savingData.set(false);
          this.event.set(ev);
          this.toasts.success('Cambios guardados.');
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

  protected toggleLocForm(): void {
    this.showLocForm.update((v) => !v);
  }

  protected manageSeats(l: LocalityView): void {
    void this.router.navigate(
      ['/promotor/eventos', this.eventId(), 'localidades', l.id, 'asientos'],
      { queryParams: this.from() === 'admin' ? { from: 'admin' } : {} },
    );
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
          this.showLocForm.set(false);
          this.toasts.success('Localidad agregada.');
          this.loadLocalities();
        },
        error: () => this.toasts.error('No se pudo agregar la localidad (¿evento publicado?).'),
      });
  }

  protected askRemoveLocality(l: LocalityView): void {
    this.confirm.set({
      title: 'Eliminar localidad',
      message: `¿Seguro que deseas eliminar la localidad "${l.name}"? Esta acción no se puede deshacer.`,
      onConfirm: () => this.removeLocality(l),
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

  protected toggleLocSearch(): void {
    const open = !this.locSearchOpen();
    this.locSearchOpen.set(open);
    if (!open) this.locSearch.set('');
  }

  // --- Banner: subir imagen ya hecha ---
  protected onBannerFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.toasts.error('El banner debe ser una imagen.');
      return;
    }
    this.uploadingBanner.set(true);
    // Vista previa inmediata mientras sube.
    const localUrl = URL.createObjectURL(file);
    this.media.uploadBanner(this.eventId(), file).subscribe({
      next: () => {
        this.uploadingBanner.set(false);
        this.bannerUrl.set(localUrl);
        this.toasts.success('Banner subido.');
        this.reload();
      },
      error: () => {
        this.uploadingBanner.set(false);
        this.toasts.error('No se pudo subir el banner.');
      },
    });
    input.value = '';
  }

  protected toggleAiForm(): void {
    this.showAiForm.update((v) => !v);
  }

  // --- Banner: generar con IA ---
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
    const reason = this.publishBlock();
    if (reason) {
      this.toasts.warning(reason);
      return;
    }
    this.api.publish(this.eventId()).subscribe({
      next: (ev) => {
        this.event.set(ev);
        this.toasts.success('Evento publicado.');
      },
      error: (err) => this.toasts.error(this.publishError(err)),
    });
  }

  /** Mensaje del backend (422 con el detalle de qué falta) o uno genérico. */
  private publishError(err: unknown): string {
    const msg = (err as { error?: { message?: string | string[] } })?.error?.message;
    if (Array.isArray(msg)) return msg.join(' ');
    if (typeof msg === 'string') return msg;
    return 'No se pudo publicar el evento.';
  }

  protected askCancelEvent(): void {
    this.confirm.set({
      title: 'Cancelar evento',
      message: `¿Seguro que deseas cancelar "${this.event()?.name ?? 'este evento'}"? Dejará de venderse.`,
      confirmLabel: 'Cancelar evento',
      confirmIcon: 'cancel',
      onConfirm: () => this.cancelEvent(),
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

  protected askRemove(): void {
    this.confirm.set({
      title: 'Eliminar evento',
      message: `¿Seguro que deseas eliminar "${this.event()?.name ?? 'este evento'}"? Esta acción no se puede deshacer.`,
      onConfirm: () => this.remove(),
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
