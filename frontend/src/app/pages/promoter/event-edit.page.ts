import { Component, computed, DestroyRef, OnDestroy, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { CategoriesApi } from '../../core/api/categories.api';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { HallsApi } from '../../core/api/halls.api';
import { MediaApi } from '../../core/api/media.api';
import { EditUnlockStore } from '../../core/events/edit-unlock.store';
import { SessionStore } from '../../core/auth/session.store';
import { ToastService } from '../../core/ui/toast.service';
import {
  ConfirmDialogComponent,
  type ConfirmRequest,
} from '../../shared/confirm-dialog/confirm-dialog.component';
import { EventSettlementComponent } from '../../shared/event-settlement/event-settlement.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { MapPickerComponent, type MapLocation } from '../../shared/map/map-picker.component';
import type {
  CategoryResponseDto,
  GatewayResponseDto,
  HallResponseDto,
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
  imports: [
    FormsModule,
    RouterLink,
    EventSettlementComponent,
    IconComponent,
    ConfirmDialogComponent,
    MapPickerComponent,
    TranslatePipe,
  ],
  templateUrl: './event-edit.page.html',
})
export class EventEditPage implements OnDestroy {
  private readonly api = inject(PromoterEventsApi);
  private readonly hallsApi = inject(HallsApi);
  private readonly media = inject(MediaApi);
  private readonly categoriesApi = inject(CategoriesApi);
  private readonly editUnlock = inject(EditUnlockStore);
  private readonly session = inject(SessionStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);
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

  // --- Desbloqueo de edición: se activa por DUEÑO real, no por ?from=admin ---
  /**
   * true cuando el usuario actual es ADMIN y NO es el dueño del evento cargado.
   * El promotor dueño (o el admin dueño) nunca requiere desbloqueo. Mientras el
   * evento no se ha cargado, no se puede determinar la propiedad → no bloquea.
   */
  protected readonly adminContext = computed(() => {
    const ev = this.event();
    const uid = this.session.user()?.id;
    return this.session.hasRole('admin') && !!ev && !!uid && ev.promoterId !== uid;
  });
  /** Bloqueado mientras el admin no-dueño no desbloquee (o expiró). El dueño nunca se bloquea. */
  protected readonly locked = computed(
    () => this.adminContext() && !this.isNew() && !this.editUnlock.isUnlocked(this.eventId()),
  );
  /** Estado del modal de desbloqueo. */
  protected readonly showUnlockModal = signal(false);
  protected readonly unlockSending = signal(false);
  protected readonly unlockSent = signal(false);
  protected readonly unlockCode = signal('');
  protected readonly unlocking = signal(false);
  /** Salones disponibles (para el selector del promotor). */
  protected readonly halls = signal<HallResponseDto[]>([]);
  protected readonly backLink = computed(() =>
    this.from() === 'admin' ? '/configuracion' : '/promotor',
  );
  protected readonly backLabel = computed(() =>
    this.from() === 'admin'
      ? this.translate.instant('promoter.edit.backToConsole')
      : this.translate.instant('promoter.edit.backToMyEvents'),
  );

  // Datos
  protected readonly d = {
    name: signal(''),
    description: signal(''),
    categoryId: signal(''),
    hallId: signal(''),
    address: signal(''),
    lat: signal<number | null>(null),
    lng: signal<number | null>(null),
    startsAt: signal(''),
  };
  /** Muestra/oculta el mapa de ubicación en el campo Dirección. */
  protected readonly showMap = signal(false);
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
  /** Localidad en edición (PATCH) o null cuando se está creando una nueva. */
  protected readonly editingLoc = signal<LocalityView | null>(null);

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

  /**
   * ¿Hay banner? Un cover en el media del evento (el detalle gestionable NO trae
   * URL firmada, solo la key → NO basta con `bannerUrl`) o uno recién subido/
   * generado (preview local). Así el gate de publicar refleja la realidad sin
   * requerir recarga tras subir el banner.
   */
  protected readonly hasBanner = computed(
    () => !!this.bannerUrl() || !!this.event()?.media?.some((m) => m.kind === 'cover'),
  );

  /**
   * Motivo por el que NO se puede publicar (o null si sí). Refleja el gate del
   * backend: evento guardado + banner + toda localidad seated con asientos.
   */
  protected readonly publishBlock = computed<string | null>(() => {
    if (this.isNew() || !this.event()) return this.translate.instant('promoter.edit.pbSaveFirst');
    if (this.localities().length === 0) return this.translate.instant('promoter.edit.pbAddLocality');
    if (!this.hasBanner()) return this.translate.instant('promoter.edit.pbAddBanner');
    const emptySeated = this.localities().find(
      (l) => l.kind === 'seated' && (l.capacity ?? 0) === 0,
    );
    if (emptySeated)
      return this.translate.instant('promoter.edit.pbSeatless', { name: emptySeated.name });
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
    this.hallsApi.list().subscribe({ next: (h) => this.halls.set(h), error: () => undefined });
    // Contexto para el interceptor: adjunta x-edit-unlock del evento activo (admin).
    if (!this.isNew()) this.editUnlock.setCurrentEvent(this.eventId());

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

  ngOnDestroy(): void {
    this.editUnlock.clearCurrentEvent();
  }

  // --- Desbloqueo de edición (admin) ---
  protected openUnlock(): void {
    this.showUnlockModal.set(true);
    this.unlockSent.set(false);
    this.unlockCode.set('');
  }
  protected closeUnlock(): void {
    this.showUnlockModal.set(false);
  }
  /** Pide el OTP al correo del admin. */
  protected requestUnlock(): void {
    this.unlockSending.set(true);
    this.api.requestEditUnlock(this.eventId()).subscribe({
      next: () => {
        this.unlockSending.set(false);
        this.unlockSent.set(true);
        this.toasts.info(this.translate.instant('promoter.edit.toastUnlockSent'));
      },
      error: () => {
        this.unlockSending.set(false);
        this.toasts.error(this.translate.instant('promoter.edit.toastUnlockSendError'));
      },
    });
  }
  /** Verifica el OTP → guarda el token (5 min); el interceptor lo adjunta. */
  protected verifyUnlock(): void {
    const code = this.unlockCode().trim();
    if (code.length !== 6) {
      this.toasts.warning(this.translate.instant('promoter.edit.toastEnterCode'));
      return;
    }
    this.unlocking.set(true);
    this.api.verifyEditUnlock(this.eventId(), code).subscribe({
      next: (res) => {
        this.unlocking.set(false);
        this.editUnlock.setUnlock(this.eventId(), res.token, res.expiresAt);
        this.showUnlockModal.set(false);
        this.toasts.success(this.translate.instant('promoter.edit.toastUnlocked'));
      },
      error: () => {
        this.unlocking.set(false);
        this.toasts.error(this.translate.instant('promoter.edit.toastCodeInvalid'));
      },
    });
  }

  /** Si está bloqueado, avisa (sin perder los cambios del form) y devuelve true. */
  private blockedByLock(): boolean {
    if (this.locked()) {
      this.toasts.warning(this.translate.instant('promoter.edit.toastUnlockToSave'));
      this.openUnlock();
      return true;
    }
    return false;
  }

  // --- Salón: al elegirlo, prefija la ubicación del evento ---
  protected onHallChange(hallId: string): void {
    this.d.hallId.set(hallId);
    const hall = this.halls().find((h) => h.id === hallId);
    if (hall) {
      if (hall.address) this.d.address.set(hall.address);
      this.d.lat.set(hall.lat ?? null);
      this.d.lng.set(hall.lng ?? null);
    }
  }

  /** Actualiza dirección/coords desde el mapa. */
  protected onMapLocation(loc: MapLocation): void {
    this.d.lat.set(loc.lat);
    this.d.lng.set(loc.lng);
    if (loc.address) this.d.address.set(loc.address);
  }

  protected toggleMap(): void {
    this.showMap.update((v) => !v);
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
    this.d.lat.set(ev.lat ?? null);
    this.d.lng.set(ev.lng ?? null);
    this.d.startsAt.set(toLocalInput(ev.startsAt));
    this.c.gatewayId.set(ev.gatewayId ?? '');
    this.c.ivaOnNet.set(ev.ivaOnNet);
    this.c.absorbInstallmentCost.set(ev.absorbInstallmentCost);
    // El detalle gestionable no trae URL firmada del cover; si ya tenemos un
    // preview local (recién subido/generado) lo conservamos para no perderlo al
    // recargar. Solo se limpia si el evento realmente no tiene cover.
    const cover = ev.media?.find((m) => m.kind === 'cover');
    this.bannerUrl.set(cover?.url ?? (cover ? this.bannerUrl() : null));
  }

  protected selectTab(t: Tab): void {
    this.tab.set(t);
  }

  // --- Datos / Guardar (crea en modo nuevo; actualiza en edición) ---
  protected saveData(): void {
    if (this.blockedByLock()) return;
    if (!this.d.name() || this.d.name().trim().length < 3) {
      this.toasts.warning(this.translate.instant('promoter.edit.toastNameRequired'));
      return;
    }
    if (this.isNew() && !this.d.startsAt()) {
      this.toasts.warning(this.translate.instant('promoter.edit.toastStartRequired'));
      return;
    }
    this.savingData.set(true);
    if (this.isNew()) {
      this.api
        .create({
          name: this.d.name(),
          description: this.d.description() || undefined,
          categoryId: this.d.categoryId() || undefined,
          hallId: this.d.hallId() || undefined,
          address: this.d.address() || undefined,
          lat: this.d.lat() ?? undefined,
          lng: this.d.lng() ?? undefined,
          startsAt: new Date(this.d.startsAt()).toISOString(),
          ivaOnNet: this.c.ivaOnNet(),
          absorbInstallmentCost: this.c.absorbInstallmentCost(),
        })
        .subscribe({
          next: (ev) => {
            this.savingData.set(false);
            this.toasts.success(this.translate.instant('promoter.edit.toastCreated'));
            // Pasa a modo edición reemplazando la URL por la del evento real.
            void this.router.navigate(['/promotor/eventos', ev.id, 'editar'], {
              replaceUrl: true,
              queryParams: this.from() === 'admin' ? { from: 'admin' } : {},
            });
          },
          error: () => {
            this.savingData.set(false);
            this.toasts.error(this.translate.instant('promoter.edit.toastCreateError'));
          },
        });
      return;
    }
    this.api
      .update(this.eventId(), {
        name: this.d.name(),
        description: this.d.description() || undefined,
        categoryId: this.d.categoryId() || undefined,
        hallId: this.d.hallId() || undefined,
        address: this.d.address() || undefined,
        lat: this.d.lat() ?? undefined,
        lng: this.d.lng() ?? undefined,
        startsAt: this.d.startsAt() ? new Date(this.d.startsAt()).toISOString() : undefined,
        ivaOnNet: this.c.ivaOnNet(),
        absorbInstallmentCost: this.c.absorbInstallmentCost(),
      })
      .subscribe({
        next: (ev) => {
          this.savingData.set(false);
          this.event.set(ev);
          this.toasts.success(this.translate.instant('promoter.edit.toastChangesSaved'));
        },
        error: () => {
          this.savingData.set(false);
          this.toasts.error(this.translate.instant('promoter.edit.toastSaveDataError'));
        },
      });
  }

  // --- Configuración ---
  protected saveConfig(): void {
    if (this.blockedByLock()) return;
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
          this.toasts.success(this.translate.instant('promoter.edit.toastConfigSaved'));
        },
        error: () => {
          this.savingConfig.set(false);
          this.toasts.error(this.translate.instant('promoter.edit.toastConfigError'));
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
    const open = !this.showLocForm();
    this.showLocForm.set(open);
    // Abrir para "crear" limpia cualquier edición en curso.
    if (open) this.editingLoc.set(null);
    if (!open) this.resetLocForm();
  }

  private resetLocForm(): void {
    this.locForm.name.set('');
    this.locForm.kind.set('general');
    this.locForm.capacity.set(null);
    this.locForm.desiredNet.set(null);
    this.pricePreview.set(null);
    this.editingLoc.set(null);
  }

  /** Abre el form con los datos de una localidad para editarla (solo no-publicado). */
  protected startEditLocality(l: LocalityView): void {
    if (this.isPublished()) return;
    this.editingLoc.set(l);
    this.showLocForm.set(true);
    this.locForm.name.set(l.name);
    this.locForm.kind.set(l.kind);
    this.locForm.capacity.set(l.capacity ?? null);
    const net = l.desiredNet != null ? Number(l.desiredNet) : null;
    this.locForm.desiredNet.set(net);
    if (net != null && net > 0) this.onNetChange(net);
  }

  protected manageSeats(l: LocalityView): void {
    void this.router.navigate(
      ['/promotor/eventos', this.eventId(), 'localidades', l.id, 'asientos'],
      { queryParams: this.from() === 'admin' ? { from: 'admin' } : {} },
    );
  }

  protected addLocality(): void {
    if (this.blockedByLock()) return;
    if (!this.locForm.name()) {
      this.toasts.warning(this.translate.instant('promoter.edit.toastLocalityNameRequired'));
      return;
    }
    const kind = this.locForm.kind();
    const editing = this.editingLoc();
    // Modo edición: PATCH sobre la localidad existente (solo no-publicado).
    if (editing) {
      this.api
        .updateLocality(editing.id, {
          name: this.locForm.name(),
          kind,
          capacity: kind === 'general' ? this.locForm.capacity() ?? undefined : undefined,
          desiredNet: this.locForm.desiredNet() ?? undefined,
        })
        .subscribe({
          next: () => {
            this.resetLocForm();
            this.showLocForm.set(false);
            this.toasts.success(this.translate.instant('promoter.edit.toastLocalityUpdated'));
            this.loadLocalities();
          },
          error: () =>
            this.toasts.error(this.translate.instant('promoter.edit.toastLocalityUpdateError')),
        });
      return;
    }
    this.api
      .addLocality(this.eventId(), {
        name: this.locForm.name(),
        kind,
        capacity: kind === 'general' ? this.locForm.capacity() ?? undefined : undefined,
        desiredNet: this.locForm.desiredNet() ?? undefined,
      })
      .subscribe({
        next: () => {
          this.resetLocForm();
          this.showLocForm.set(false);
          this.toasts.success(this.translate.instant('promoter.edit.toastLocalityAdded'));
          this.loadLocalities();
        },
        error: () =>
          this.toasts.error(this.translate.instant('promoter.edit.toastLocalityAddError')),
      });
  }

  protected askRemoveLocality(l: LocalityView): void {
    if (this.blockedByLock()) return;
    this.confirm.set({
      title: this.translate.instant('promoter.edit.deleteLocalityTitle'),
      message: this.translate.instant('promoter.edit.confirmDeleteLocalityMsg', { name: l.name }),
      onConfirm: () => this.removeLocality(l),
    });
  }

  protected removeLocality(l: LocalityView): void {
    this.api.removeLocality(l.id).subscribe({
      next: () => {
        this.toasts.info(this.translate.instant('promoter.edit.toastLocalityRemoved'));
        this.loadLocalities();
      },
      error: () => this.toasts.error(this.translate.instant('promoter.edit.toastLocalityRemoveError')),
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
      this.toasts.error(this.translate.instant('promoter.edit.toastBannerImage'));
      return;
    }
    this.uploadingBanner.set(true);
    // Vista previa inmediata mientras sube.
    const localUrl = URL.createObjectURL(file);
    this.media.uploadBanner(this.eventId(), file).subscribe({
      next: () => {
        this.uploadingBanner.set(false);
        this.bannerUrl.set(localUrl);
        this.toasts.success(this.translate.instant('promoter.edit.toastBannerUploaded'));
        this.reload();
      },
      error: () => {
        this.uploadingBanner.set(false);
        this.toasts.error(this.translate.instant('promoter.edit.toastBannerUploadError'));
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
          this.toasts.success(this.translate.instant('promoter.edit.toastBannerGenerated'));
        },
        error: () => {
          this.generatingBanner.set(false);
          this.toasts.error(this.translate.instant('promoter.edit.toastBannerGenerateError'));
        },
      });
  }

  // --- Acciones de estado ---
  /** Pide confirmación antes de publicar (modal). */
  protected askPublish(): void {
    if (this.blockedByLock()) return;
    const reason = this.publishBlock();
    if (reason) {
      this.toasts.warning(reason);
      return;
    }
    this.confirm.set({
      title: this.translate.instant('promoter.edit.publishEventTitle'),
      message: this.translate.instant('promoter.edit.confirmPublishMsg', {
        name: this.event()?.name ?? this.translate.instant('promoter.edit.thisEvent'),
      }),
      confirmLabel: this.translate.instant('promoter.edit.publish'),
      confirmIcon: 'publish',
      onConfirm: () => this.publish(),
    });
  }

  protected publish(): void {
    const reason = this.publishBlock();
    if (reason) {
      this.toasts.warning(reason);
      return;
    }
    this.api.publish(this.eventId()).subscribe({
      next: (ev) => {
        this.event.set(ev);
        this.toasts.success(this.translate.instant('promoter.edit.toastPublished'));
      },
      error: (err) => this.toasts.error(this.publishError(err)),
    });
  }

  /** Mensaje del backend (422 con el detalle de qué falta) o uno genérico. */
  private publishError(err: unknown): string {
    const msg = (err as { error?: { message?: string | string[] } })?.error?.message;
    if (Array.isArray(msg)) return msg.join(' ');
    if (typeof msg === 'string') return msg;
    return this.translate.instant('promoter.edit.toastPublishError');
  }

  protected askCancelEvent(): void {
    this.confirm.set({
      title: this.translate.instant('promoter.edit.cancelEvent'),
      message: this.translate.instant('promoter.edit.confirmCancelMsg', {
        name: this.event()?.name ?? this.translate.instant('promoter.edit.thisEvent'),
      }),
      confirmLabel: this.translate.instant('promoter.edit.cancelEvent'),
      confirmIcon: 'cancel',
      onConfirm: () => this.cancelEvent(),
    });
  }

  protected cancelEvent(): void {
    this.api.cancel(this.eventId()).subscribe({
      next: (ev) => {
        this.event.set(ev);
        this.toasts.info(this.translate.instant('promoter.edit.toastCancelled'));
      },
      error: () => this.toasts.error(this.translate.instant('promoter.edit.toastCancelError')),
    });
  }

  protected askRemove(): void {
    this.confirm.set({
      title: this.translate.instant('promoter.edit.deleteEventTitle'),
      message: this.translate.instant('promoter.edit.confirmDeleteMsg', {
        name: this.event()?.name ?? this.translate.instant('promoter.edit.thisEvent'),
      }),
      onConfirm: () => this.remove(),
    });
  }

  protected remove(): void {
    this.api.remove(this.eventId()).subscribe({
      next: () => {
        this.toasts.success(this.translate.instant('promoter.edit.toastRemoved'));
        void this.router.navigateByUrl(this.backLink());
      },
      error: () => this.toasts.error(this.translate.instant('promoter.edit.toastRemoveError')),
    });
  }
}
