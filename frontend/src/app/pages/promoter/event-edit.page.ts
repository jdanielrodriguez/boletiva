import { Component, computed, DestroyRef, OnDestroy, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { AdminApi, type PromoterListItemDto } from '../../core/api/admin.api';
import { CategoriesApi } from '../../core/api/categories.api';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { HallsApi } from '../../core/api/halls.api';
import { MediaApi } from '../../core/api/media.api';
import { EditUnlockStore } from '../../core/events/edit-unlock.store';
import { SessionStore } from '../../core/auth/session.store';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmController } from '../../shared/confirm-dialog/confirm-controller';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { EventSettlementComponent } from '../../shared/event-settlement/event-settlement.component';
import { EventDashboardComponent } from '../../shared/event-dashboard/event-dashboard.component';
import { EventValidatorsComponent } from './event-validators.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { OtpInputComponent } from '../../shared/ui/otp-input/otp-input.component';
import { BackLinkComponent } from '../../shared/ui/back-link.component';
import { LockChipComponent } from '../../shared/ui/lock-chip.component';
import { SwitchComponent } from '../../shared/ui/switch.component';
import {
  type HasUnsavedChanges,
  promptDiscardChanges,
} from '../../core/guards/unsaved-changes.guard';
import { MapPickerComponent, type MapLocation } from '../../shared/map/map-picker.component';
import { PagerComponent } from '../../shared/ui/pager.component';
import { LoadingComponent } from '../../shared/ui/loading.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { StatusLabelPipe } from '../../shared/ui/status-label.pipe';
import { LocalizedDatePipe } from '../../core/i18n/localized-date.pipe';
import { MoneyPipe } from '../../shared/money.pipe';
import { EventSeatMapComponent } from './event-seat-map.component';
import type {
  CategoryResponseDto,
  EventCashTransferDto,
  EventRefundResultDto,
  EventTransactionDto,
  GatewayResponseDto,
  HallResponseDto,
  LocalityView,
  ManagedEventDetailDto,
  PriceQuoteResponseDto,
} from '../../core/api/types';

type Tab = 'datos' | 'localidades' | 'banner' | 'config' | 'cuentas' | 'dashboard' | 'validadores';
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
    EventDashboardComponent,
    EventValidatorsComponent,
    EventSeatMapComponent,
    IconComponent,
    OtpInputComponent,
    BackLinkComponent,
    LockChipComponent,
    SwitchComponent,
    ConfirmDialogComponent,
    MapPickerComponent,
    PagerComponent,
    LoadingComponent,
    EmptyStateComponent,
    StatusLabelPipe,
    LocalizedDatePipe,
    MoneyPipe,
    TranslatePipe,
  ],
  templateUrl: './event-edit.page.html',
})
export class EventEditPage implements OnDestroy, HasUnsavedChanges {
  private readonly api = inject(PromoterEventsApi);
  private readonly adminApi = inject(AdminApi);
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

  protected readonly isPublished = computed(() => this.event()?.status === 'published');
  protected readonly isSuspended = computed(() => this.event()?.status === 'suspended');
  protected readonly isFinished = computed(() => this.event()?.status === 'finished');
  protected readonly isCancelled = computed(() => this.event()?.status === 'cancelled');
  /**
   * El evento ya CONCLUYÓ por fecha (`endsAt` en el pasado) = "completado". Es una de
   * las condiciones que habilitan el cierre de caja: un evento exitoso que simplemente
   * terminó por fecha se liquida sin necesidad de suspenderlo ni cancelarlo.
   */
  protected readonly hasEnded = computed(() => {
    const ends = this.event()?.endsAt;
    return !!ends && new Date(ends).getTime() < Date.now();
  });
  /**
   * ¿Sesión impersonada? La impersonación hace que la sesión SEA el promotor y trae
   * `impersonatedBy` (id del admin real) desde `/auth/me`.
   */
  protected readonly impersonating = computed(() => !!this.session.user()?.impersonatedBy);
  /**
   * ADMIN REAL: admin autenticado que NO está impersonando a un promotor (v3.11 ·
   * F1/F2). Cuando impersona, el área financiera (finalizar / devoluciones) debe
   * OCULTARSE; solo el admin real la ve.
   */
  protected readonly isAdminReal = computed(() => this.isAdmin() && !this.impersonating());
  /**
   * PUBLICABLE por ciclo de vida: solo un evento en borrador o suspendido admite el
   * botón Publicar / Volver a publicar. NO es un gate de permisos de edición (eso
   * es `canEdit`); solo decide la visibilidad del botón de publicación.
   */
  protected readonly canEditLayout = computed(() => {
    const s = this.event()?.status ?? 'draft';
    return s === 'draft' || s === 'suspended';
  });
  /** Boletos vendidos (del detalle gestionable): dispara el aviso de devoluciones. */
  protected readonly soldTicketsCount = computed(() => this.event()?.soldTicketsCount ?? 0);
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
  /** Admin no-dueño CON desbloqueo vigente: candado abierto + cuenta regresiva. */
  protected readonly unlockActive = computed(
    () => this.adminContext() && !this.isNew() && this.editUnlock.isUnlocked(this.eventId()),
  );
  /**
   * DUEÑO del evento: el promotor propietario, o el admin que lo impersona (en ese
   * caso la sesión ES el promotor → `promoterId === uid`). En modo NUEVO se trata
   * como dueño (lo está creando). El dueño NUNCA ve candado ni bloqueo.
   */
  protected readonly isOwner = computed(() => {
    if (this.isNew()) return true;
    const ev = this.event();
    const uid = this.session.user()?.id;
    return !!ev && !!uid && ev.promoterId === uid;
  });
  /**
   * ¿Puede EDITAR localidades/asientos/salón? (v3.10 · GIV — permiso RECURRENTE).
   * El gate por `status` NO aplica al dueño: el promotor dueño edita SIEMPRE, aunque
   * el evento esté publicado. Solo el admin NO-dueño requiere desbloqueo vigente.
   */
  /** Evento CONCLUIDO (terminado por fecha, finalizado o cancelado): read-only, solo ver cuentas. */
  protected readonly isConcluded = computed(
    () => this.hasEnded() || this.isFinished() || this.isCancelled(),
  );
  protected readonly canEdit = computed(
    () => (this.isOwner() || this.unlockActive()) && !this.isConcluded(),
  );
  /**
   * Tiempo restante del desbloqueo formateado mm:ss. Reactivo (el `remainingMs`
   * del store lee su `clock` interno → se recomputa cada segundo). Al llegar a 0
   * el store recomputa `isUnlocked()` → el candado se cierra solo y todo se
   * re-bloquea sin timer por componente.
   */
  protected readonly unlockRemaining = computed(() => {
    // ceil = convención de cuenta regresiva (muestra el segundo "techo": 05:00 al
    // desbloquear, 04:00 tras 60s exactos) y evita el off-by-one de floor.
    const total = Math.ceil(this.editUnlock.remainingMs(this.eventId()) / 1000);
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  });
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

  // --- Admin crea evento a nombre de un promotor (v3.8 · G2-7) ---
  /** El usuario actual es admin (habilita el selector de promotor en modo nuevo). */
  protected readonly isAdmin = computed(() => this.session.hasRole('admin'));
  /** Lista de promotores APROBADOS (solo se carga si el creador es admin). */
  protected readonly promoters = signal<PromoterListItemDto[]>([]);
  /** Promotor elegido por el admin al crear (obligatorio en modo nuevo admin). */
  protected readonly newPromoterId = signal<string>('');
  /**
   * Id del admin que creó el evento a nombre del promotor (badge "creado por
   * soporte"). Solo presente si el detalle lo trae y no es null.
   */
  protected readonly createdByAdminId = computed(() => this.event()?.createdByAdminId ?? null);
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
  /** Mapa combinado (solo lectura) bajo la lista: visible por defecto. */
  protected readonly showCombinedMap = signal(true);
  /** Localidades con asientos (seated) → alimentan el mapa combinado. */
  protected readonly seatedLocalities = computed(() =>
    this.localities().filter((l) => l.kind === 'seated'),
  );

  // --- Transacciones del evento (tab Cuentas) ---
  private static readonly TX_PAGE = 10;
  protected readonly txAll = signal<EventTransactionDto[]>([]);
  protected readonly txLoading = signal(false);
  protected readonly txLoaded = signal(false);
  protected readonly txPage = signal(1);
  protected readonly txTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.txAll().length / EventEditPage.TX_PAGE)),
  );
  protected readonly pageTransactions = computed(() => {
    const start = (this.txPage() - 1) * EventEditPage.TX_PAGE;
    return this.txAll().slice(start, start + EventEditPage.TX_PAGE);
  });

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
   * PREVIEW antes de subir: al elegir un archivo NO se sube todavía; se muestra
   * una vista previa (arriba del bloque "Generar con IA") con Guardar/Cancelar.
   * Solo al Guardar se ejecuta la subida real (presign→PUT→registrar).
   */
  protected readonly pendingBannerFile = signal<File | null>(null);
  protected readonly pendingBannerUrl = signal<string | null>(null);

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

  // --- Cierre + transferencia de saldos de caja (SOLO admin REAL, tab Cuentas) ---
  protected readonly finalizing = signal(false);
  protected readonly cashResult = signal<EventCashTransferDto | null>(null);
  protected readonly cashError = signal<string | null>(null);
  /**
   * Neto del promotor que se acreditará al finalizar (vista del admin REAL). El admin
   * real NO ve la tabla de transacciones ni las devoluciones; solo el neto a
   * transferir + el botón de finalizar. Se carga desde el settlement al entrar a la
   * tab Cuentas siendo admin real.
   */
  protected readonly settlementNet = signal<string | null>(null);
  protected readonly settlementCurrency = signal('GTQ');
  protected readonly settlementNetLoading = signal(false);
  /**
   * Sección "evento finalizado / pagar al promotor": VISIBLE para el admin REAL (no
   * impersonando) en cualquier evento existente, aunque el botón esté deshabilitado.
   * El usuario pidió que el admin SIEMPRE vea la sección (no ocultarla); solo se
   * habilita el botón según el estado (`canFinalizeNow`). NUNCA se bloquea por el
   * candado de edición; el promotor y la impersonación no la ven.
   */
  protected readonly canSeeFinalize = computed(() => this.isAdminReal() && !this.isNew());
  /**
   * ¿El cierre de caja se puede EJECUTAR ahora? Solo si el evento está suspendido,
   * cancelado, ya finalizado, o COMPLETADO (concluido por fecha) — mismos criterios
   * que valida el backend. Mientras no cumpla ninguno, la sección se ve pero el botón
   * queda deshabilitado con un aviso.
   */
  protected readonly canFinalizeNow = computed(
    () => this.isSuspended() || this.isCancelled() || this.isFinished() || this.hasEnded(),
  );
  /** El admin real ve el DETALLE de cuentas del evento (igual que el dueño). */
  protected readonly canSeeAccounts = computed(() => this.isOwner() || this.isAdminReal());

  // --- Devoluciones por cancelación/suspensión (OWNER, tab Cuentas) ---
  protected readonly refunding = signal(false);
  protected readonly refundResult = signal<EventRefundResultDto | null>(null);
  protected readonly refundError = signal<string | null>(null);
  /** Token que fuerza recargar el settlement embebido tras devolver. */
  protected readonly settlementReloadToken = signal(0);
  /**
   * Botones de devolución visibles para el DUEÑO del evento (promotor propietario o
   * admin impersonándolo) y solo cuando el evento está suspendido o cancelado
   * (requisito del backend). El ADMIN REAL (no impersonando) NO los ve: el backend
   * ahora permite el refund al promotor dueño y devolvería 403 al admin real.
   */
  protected readonly canRefund = computed(
    () => this.isOwner() && !this.isNew() && (this.isSuspended() || this.isCancelled()),
  );

  // --- Guard de cambios sin guardar (datos + configuración) ---
  /** Snapshot serializado del último estado guardado (para detectar "dirty"). */
  private readonly savedSnapshot = signal('');
  /** Se activa antes de una navegación programática tras guardar/eliminar (no preguntar). */
  private skipGuard = false;
  /** Serializa los campos persistibles del formulario (datos + config). */
  private snapshot(): string {
    return JSON.stringify({
      name: this.d.name(),
      description: this.d.description(),
      categoryId: this.d.categoryId(),
      hallId: this.d.hallId(),
      address: this.d.address(),
      lat: this.d.lat(),
      lng: this.d.lng(),
      startsAt: this.d.startsAt(),
      gatewayId: this.c.gatewayId(),
      ivaOnNet: this.c.ivaOnNet(),
      absorbInstallmentCost: this.c.absorbInstallmentCost(),
      promoterId: this.newPromoterId(),
    });
  }

  // Confirmación de acciones destructivas (modal reutilizable).
  protected readonly confirm = new ConfirmController();

  /** Hay cambios en el formulario de datos/config sin guardar. */
  hasUnsavedChanges(): boolean {
    return !this.skipGuard && this.snapshot() !== this.savedSnapshot();
  }
  /** Abre el modal "¿descartar cambios?" (reutiliza el confirm-dialog del componente). */
  confirmDiscard(): Observable<boolean> {
    return promptDiscardChanges(
      (req) => this.confirm.ask(req),
      (k) => this.translate.instant(k),
    );
  }

  constructor() {
    this.categoriesApi.list().subscribe({ next: (c) => this.categories.set(c), error: () => undefined });
    this.api.activeGateways().subscribe({ next: (g) => this.gateways.set(g), error: () => undefined });
    this.hallsApi.list().subscribe({ next: (h) => this.halls.set(h), error: () => undefined });
    // Modo nuevo + admin: carga los promotores APROBADOS para el selector obligatorio
    // (endpoint admin-only; el promotor normal no lo llama porque no ve el selector).
    if (this.isNew() && this.isAdmin()) {
      this.adminApi.listPromoters('approved').subscribe({
        next: (p) => this.promoters.set(p),
        error: () => undefined,
      });
    }
    // Contexto para el interceptor: adjunta x-edit-unlock del evento activo (admin).
    if (!this.isNew()) this.editUnlock.setCurrentEvent(this.eventId());

    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (tab && ['datos', 'localidades', 'banner', 'config', 'cuentas', 'dashboard', 'validadores'].includes(tab)) {
      this.tab.set(tab as Tab);
      // Los datos de la tab Cuentas dependen del rol (owner vs admin real) y del
      // estado del evento → se cargan tras `reload()`, no aquí (el evento aún no está).
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
      // Base del guard: el formulario en blanco NO es dirty hasta que se teclee.
      this.savedSnapshot.set(this.snapshot());
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
        // Deep-link ?tab=cuentas: ya con el evento cargado, carga lo que toca por rol.
        if (this.tab() === 'cuentas') this.loadAccountsData();
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
    // Salón asignado (B3, v3.11): sin esto el select quedaba vacío al recargar y un
    // re-guardado desasignaba el salón. Refleja el `hallId` persistido del evento.
    this.d.hallId.set(ev.hallId ?? '');
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
    // Base del guard de cambios sin guardar: el estado recién cargado NO es dirty.
    this.savedSnapshot.set(this.snapshot());
  }

  protected selectTab(t: Tab): void {
    this.tab.set(t);
    if (t === 'cuentas') this.loadAccountsData();
  }

  /**
   * Carga de la tab Cuentas según el rol: el DUEÑO y el ADMIN REAL ven la tabla de
   * transacciones (cursor); el ADMIN REAL además carga el neto a transferir para la
   * sección de cierre. El admin ya no necesita impersonar para ver las cuentas.
   */
  private loadAccountsData(): void {
    if (this.isNew()) return;
    if (this.canSeeAccounts()) {
      if (!this.txLoaded()) this.loadTransactions();
    }
    if (this.isAdminReal()) {
      this.loadSettlementNet();
    }
  }

  /** Neto a transferir (settlement) para la vista del admin real. */
  private loadSettlementNet(): void {
    this.settlementNetLoading.set(true);
    this.api.settlement(this.eventId()).subscribe({
      next: (s) => {
        this.settlementNet.set(s.net);
        this.settlementCurrency.set(s.currency);
        this.settlementNetLoading.set(false);
      },
      error: () => this.settlementNetLoading.set(false),
    });
  }

  protected toggleCombinedMap(): void {
    this.showCombinedMap.update((v) => !v);
  }

  protected setTxPage(p: number): void {
    this.txPage.set(p);
  }

  /** Abre el detalle de una transacción (dueño/admin). */
  protected openTx(orderId: string): void {
    void this.router.navigate(['/cuenta/transaccion', orderId]);
  }

  /**
   * Carga TODAS las transacciones del evento siguiendo el cursor keyset (páginas de
   * 100) y las acumula; luego se pagina en cliente con el pager compartido. Igual
   * patrón que la facturación de la cuenta (lista completa → paginación local).
   */
  private loadTransactions(cursor?: string, acc: EventTransactionDto[] = []): void {
    this.txLoading.set(true);
    this.api.transactions(this.eventId(), cursor, 100).subscribe({
      next: (p) => {
        const items = [...acc, ...(p.items ?? [])];
        if (p.nextCursor) {
          this.loadTransactions(p.nextCursor, items);
        } else {
          this.txAll.set(items);
          this.txLoading.set(false);
          this.txLoaded.set(true);
        }
      },
      error: () => {
        this.txAll.set(acc);
        this.txLoading.set(false);
        this.txLoaded.set(true);
      },
    });
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
    // Admin creando: debe elegir a nombre de qué promotor (obligatorio).
    if (this.isNew() && this.isAdmin() && !this.newPromoterId()) {
      this.toasts.warning(this.translate.instant('promoter.edit.promoterRequired'));
      return;
    }
    this.savingData.set(true);
    if (this.isNew()) {
      this.api
        .create({
          name: this.d.name(),
          description: this.d.description() || undefined,
          categoryId: this.d.categoryId() || undefined,
          // Solo el admin envía promoterId (el backend lo ignora para no-admin).
          promoterId: this.isAdmin() ? this.newPromoterId() || undefined : undefined,
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
            // Navegación programática tras guardar → no dispares el guard de cambios.
            this.skipGuard = true;
            // Pasa a modo edición reemplazando la URL por la del evento real.
            void this.router.navigate(['/promotor/eventos', ev.id, 'editar'], {
              replaceUrl: true,
              queryParams: this.from() === 'admin' ? { from: 'admin' } : {},
            });
          },
          error: (err) => {
            this.savingData.set(false);
            this.toasts.error(
              this.backendMessage(err, 'promoter.edit.toastCreateError'),
            );
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
          this.savedSnapshot.set(this.snapshot());
          this.toasts.success(this.translate.instant('promoter.edit.toastChangesSaved'));
        },
        error: (err) => {
          this.savingData.set(false);
          // Muestra el mensaje REAL del backend (p.ej. 409 al cambiar de salón con
          // boletos vendidos). El genérico queda solo como fallback.
          this.toasts.error(this.backendMessage(err, 'promoter.edit.toastSaveDataError'));
          this.suggestSuspendIfConflict(err);
        },
      });
  }

  /**
   * Extrae el mensaje de error del backend (string o array de validación) para
   * mostrarlo tal cual; si no viene, usa la clave i18n de fallback.
   */
  private backendMessage(err: unknown, fallbackKey: string): string {
    const msg = (err as { error?: { message?: string | string[] } })?.error?.message;
    if (Array.isArray(msg) && msg.length) return msg.join(' ');
    if (typeof msg === 'string' && msg.trim()) return msg;
    return this.translate.instant(fallbackKey);
  }

  /**
   * Si el guardado chocó por conflicto (409) en un evento publicado, sugiere
   * SUSPENDER para reorganizar (el suspendido ya permite cambiar salón/plantilla/
   * pasarela). Solo un aviso; no fuerza nada.
   */
  private suggestSuspendIfConflict(err: unknown): void {
    const status = (err as { status?: number })?.status;
    if (status === 409 && this.isPublished()) {
      this.toasts.info(this.translate.instant('promoter.edit.suggestSuspendToReorg'));
    }
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
          this.savedSnapshot.set(this.snapshot());
          this.toasts.success(this.translate.instant('promoter.edit.toastConfigSaved'));
        },
        error: (err) => {
          this.savingConfig.set(false);
          this.toasts.error(this.backendMessage(err, 'promoter.edit.toastConfigError'));
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

  /** Abre el form con los datos de una localidad para editarla (draft o suspendido). */
  protected startEditLocality(l: LocalityView): void {
    if (!this.canEdit()) return;
    this.editingLoc.set(l);
    this.showLocForm.set(true);
    this.locForm.name.set(l.name);
    this.locForm.kind.set(l.kind);
    this.locForm.capacity.set(l.capacity ?? null);
    const net = l.desiredNet != null ? Number(l.desiredNet) : null;
    this.locForm.desiredNet.set(net);
    if (net != null && net > 0) this.onNetChange(net);
  }

  /** Ruta a la vista de asientos de una localidad (RouterLink → sigue accesible
   * aunque el evento esté bloqueado por admin: solo se ve en modo lectura). */
  protected seatsLink(l: LocalityView): (string | number)[] {
    return ['/promotor/eventos', this.eventId(), 'localidades', l.id, 'asientos'];
  }
  /** QueryParams del enlace a asientos (preserva `?from=admin`). */
  protected readonly seatsQuery = computed(() =>
    this.from() === 'admin' ? { from: 'admin' } : {},
  );

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
    this.confirm.ask({
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

  // --- Banner: elegir imagen → PREVIEW (no sube todavía) ---
  protected onBannerFile(event: Event): void {
    if (this.locked()) return; // edición bloqueada (admin sin desbloquear)
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.toasts.error(this.translate.instant('promoter.edit.toastBannerImage'));
      input.value = '';
      return;
    }
    // Descarta un preview anterior sin usar.
    const prev = this.pendingBannerUrl();
    if (prev) URL.revokeObjectURL(prev);
    this.pendingBannerFile.set(file);
    this.pendingBannerUrl.set(URL.createObjectURL(file));
    input.value = '';
  }

  /** Descarta el preview sin subir nada. */
  protected cancelBannerPreview(): void {
    const url = this.pendingBannerUrl();
    if (url) URL.revokeObjectURL(url);
    this.pendingBannerFile.set(null);
    this.pendingBannerUrl.set(null);
  }

  /** Guarda el preview: ejecuta la subida real y lo lleva a la posición del banner. */
  protected saveBannerPreview(): void {
    if (this.locked()) return; // edición bloqueada (admin sin desbloquear)
    const file = this.pendingBannerFile();
    if (!file) return;
    const localUrl = this.pendingBannerUrl();
    this.uploadingBanner.set(true);
    this.media.uploadBanner(this.eventId(), file).subscribe({
      next: () => {
        this.uploadingBanner.set(false);
        // El objectURL del preview pasa a ser el banner activo (no lo revocamos).
        this.bannerUrl.set(localUrl);
        this.pendingBannerFile.set(null);
        this.pendingBannerUrl.set(null);
        this.toasts.success(this.translate.instant('promoter.edit.toastBannerUploaded'));
        this.reload();
      },
      error: () => {
        this.uploadingBanner.set(false);
        this.toasts.error(this.translate.instant('promoter.edit.toastBannerUploadError'));
      },
    });
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
    this.confirm.ask({
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

  protected askSuspend(): void {
    if (this.blockedByLock()) return;
    this.confirm.ask({
      title: this.translate.instant('promoter.edit.suspendEventTitle'),
      message: this.translate.instant('promoter.edit.confirmSuspendMsg', {
        name: this.event()?.name ?? this.translate.instant('promoter.edit.thisEvent'),
      }),
      confirmLabel: this.translate.instant('promoter.edit.suspendEvent'),
      confirmIcon: 'cancel',
      onConfirm: () => this.suspend(),
    });
  }

  protected suspend(): void {
    this.api.suspend(this.eventId()).subscribe({
      next: (ev) => {
        this.event.set(ev);
        this.toasts.info(this.translate.instant('promoter.edit.toastSuspended'));
      },
      error: () => this.toasts.error(this.translate.instant('promoter.edit.toastSuspendError')),
    });
  }

  protected askCancelEvent(): void {
    this.confirm.ask({
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
    this.confirm.ask({
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
        this.skipGuard = true;
        void this.router.navigateByUrl(this.backLink());
      },
      error: () => this.toasts.error(this.translate.instant('promoter.edit.toastRemoveError')),
    });
  }

  // --- Cierre + transferencia de saldos de caja (SOLO admin) ---
  /** Modal de validación antes de transferir el saldo del evento al promotor. */
  protected askFinalizeCash(): void {
    this.confirm.ask({
      title: this.translate.instant('promoter.edit.cashTransferTitle'),
      message: this.translate.instant('promoter.edit.cashTransferConfirm', {
        name: this.event()?.name ?? this.translate.instant('promoter.edit.thisEvent'),
      }),
      confirmLabel: this.translate.instant('promoter.edit.cashTransferConfirmBtn'),
      confirmIcon: 'save',
      titleIcon: 'accounts',
      danger: false,
      auditAction: 'event.cash_transfer',
      auditResource: this.eventId(),
      onConfirm: () => this.finalizeCash(),
    });
  }

  private finalizeCash(): void {
    this.finalizing.set(true);
    this.cashError.set(null);
    this.api.finalizeSettlement(this.eventId()).subscribe({
      next: (res) => {
        this.finalizing.set(false);
        this.cashResult.set(res);
        this.toasts.success(this.translate.instant('promoter.edit.cashTransferDone'));
        // Refleja el nuevo estado del evento (p.ej. finished) sin recargar el form.
        const ev = this.event();
        if (ev) this.event.set({ ...ev, status: res.status as ManagedEventDetailDto['status'] });
      },
      error: (err) => {
        this.finalizing.set(false);
        const status = (err as { status?: number })?.status;
        // 409 = ya transferido (idempotente): mensaje claro; otros = mensaje del backend.
        this.cashError.set(
          status === 409
            ? this.translate.instant('promoter.edit.cashTransferAlready')
            : this.backendMessage(err, 'promoter.edit.cashTransferError'),
        );
      },
    });
  }

  // --- Devoluciones por cancelación/suspensión (SOLO admin REAL) ---
  /** Confirmación para devolver TODAS las órdenes pagadas del evento. */
  protected askRefundAll(): void {
    this.confirm.ask({
      title: this.translate.instant('promoter.edit.refundAllTitle'),
      message: this.translate.instant('promoter.edit.refundAllConfirm', {
        name: this.event()?.name ?? this.translate.instant('promoter.edit.thisEvent'),
      }),
      confirmLabel: this.translate.instant('promoter.edit.refundAllBtn'),
      confirmIcon: 'accounts',
      titleIcon: 'accounts',
      danger: true,
      auditAction: 'event.refund.all',
      auditResource: this.eventId(),
      onConfirm: () => this.refund(),
    });
  }

  /** Confirmación para devolver UNA orden concreta. */
  protected askRefundOne(t: EventTransactionDto): void {
    this.confirm.ask({
      title: this.translate.instant('promoter.edit.refundOneTitle'),
      message: this.translate.instant('promoter.edit.refundOneConfirm', {
        buyer: t.buyerName || t.buyerEmail || this.translate.instant('promoter.tx.anonymous'),
      }),
      confirmLabel: this.translate.instant('promoter.edit.refundOneBtn'),
      confirmIcon: 'accounts',
      titleIcon: 'accounts',
      danger: true,
      auditAction: 'event.refund.one',
      auditResource: t.id,
      onConfirm: () => this.refund(t.id),
    });
  }

  /**
   * Tramita la devolución (una orden si `orderId`, o todas). Acredita SOLO el neto
   * a la wallet de cada comprador. Tras completar refresca settlement + lista y
   * muestra el resumen por toast.
   */
  private refund(orderId?: string): void {
    this.refunding.set(true);
    this.refundError.set(null);
    this.api.refundEvent(this.eventId(), orderId).subscribe({
      next: (res) => {
        this.refunding.set(false);
        this.refundResult.set(res);
        this.toasts.success(
          this.translate.instant('promoter.edit.refundDone', {
            n: res.refundedOrders,
            amount: res.totalNetRefunded,
            currency: res.currency,
          }),
        );
        // Refresca la liquidación embebida (refundsIssued) y la lista de transacciones.
        this.settlementReloadToken.update((v) => v + 1);
        this.loadTransactions();
      },
      error: (err) => {
        this.refunding.set(false);
        const status = (err as { status?: number })?.status;
        // 409 = el evento no está suspendido/cancelado (mensaje claro); otros = backend.
        this.refundError.set(
          status === 409
            ? this.translate.instant('promoter.edit.refundNotEligible')
            : this.backendMessage(err, 'promoter.edit.refundError'),
        );
      },
    });
  }
}
