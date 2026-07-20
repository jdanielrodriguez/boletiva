import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocalizedDatePipe } from '../../core/i18n/localized-date.pipe';
import {
  AdminApi,
  AdminEventListItemDto,
  GatewayResponseDto,
  PromoterListItemDto,
} from '../../core/api/admin.api';
import { AdvisorApi } from '../../core/api/advisor.api';
import { InvitationsApi } from '../../core/api/invitations.api';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { SettingsApi } from '../../core/api/settings.api';
import { AuditApi } from '../../core/api/audit.api';
import { ImpersonationService } from '../../core/auth/impersonation.service';
import { SessionStore } from '../../core/auth/session.store';
import { PublicConfigStore } from '../../core/config/public-config.store';
import { ThemeService } from '../../core/theme/theme.service';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmController } from '../../shared/confirm-dialog/confirm-controller';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { TourComponent, type TourStep } from '../../shared/tour/tour.component';
import { PagerComponent } from '../../shared/ui/pager.component';
import { SearchFieldComponent } from '../../shared/ui/search-field.component';
import { StatusLabelPipe } from '../../shared/ui/status-label.pipe';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { InfoTooltipComponent } from '../../shared/ui/info-tooltip.component';
import { LockChipComponent } from '../../shared/ui/lock-chip.component';
import { SwitchComponent } from '../../shared/ui/switch.component';
import { OtpInputComponent } from '../../shared/ui/otp-input/otp-input.component';
import { HallsListComponent } from './halls-list.component';
import { TemplatesListComponent } from './templates-list.component';
import type {
  CreatedInvitationDto,
  InvitationListItemDto,
  SettingViewDto,
} from '../../core/api/types';

type AdminTab = 'eventos' | 'promotores' | 'sistema' | 'invitaciones' | 'salones' | 'plantillas';

/** Grupos de la lista de eventos del admin por tiempo (default = futuros). */
type EventTimeGroup = 'upcoming' | 'ongoing' | 'past' | 'all';

/** Borrador de nueva pasarela (crear con OTP de desbloqueo). */
interface NewGatewayDraft {
  name: string;
  provider: string;
  feePct: number;
  transactionFixedFee: number;
}

/** Borrador editable de una pasarela (campos numéricos como number para el form). */
interface GatewayDraft {
  id: string;
  name: string;
  feePct: number;
  transactionFixedFee: number;
  minCostSharePct: number;
  installmentFixedFee: number;
  installmentRatesJson: string;
  installmentsEnabled: boolean;
  status: string;
}

const EVENTS_PAGE = 12;
const INV_PAGE = 9;

/**
 * Consola de administración (F-v3, SOLO admin — roleGuard admin). Tabs: Eventos,
 * Promotores, Salones, Plantillas, Sistema (pasarelas + configuraciones abajo en
 * grid) e Invitaciones. Salones y Plantillas muestran su LISTA con filtros dentro
 * del tab (v3.9 · B1, componentes `app-halls-list`/`app-templates-list`); la
 * creación/edición sigue en páginas aparte (hall-edit/template-edit).
 */
@Component({
  selector: 'app-config-page',
  imports: [
    FormsModule,
    TranslatePipe,
    LocalizedDatePipe,
    StatusLabelPipe,
    IconComponent,
    ConfirmDialogComponent,
    PagerComponent,
    EmptyStateComponent,
    InfoTooltipComponent,
    LockChipComponent,
    SwitchComponent,
    OtpInputComponent,
    HallsListComponent,
    TemplatesListComponent,
    SearchFieldComponent,
    RouterLink,
    TourComponent,
  ],
  templateUrl: './config.page.html',
})
export class ConfigPage {
  /** Tour de onboarding de la consola admin (solo admins que no lo han visto). */
  protected readonly tourSteps: TourStep[] = [
    { title: 'tour.admin.welcomeTitle', body: 'tour.admin.welcomeBody' },
    { title: 'tour.admin.eventsTitle', body: 'tour.admin.eventsBody' },
    { title: 'tour.admin.configTitle', body: 'tour.admin.configBody' },
  ];
  private readonly admin = inject(AdminApi);
  private readonly advisorApi = inject(AdvisorApi);
  private readonly promoterEvents = inject(PromoterEventsApi);
  private readonly invitationsApi = inject(InvitationsApi);
  private readonly settingsApi = inject(SettingsApi);
  private readonly audit = inject(AuditApi);
  private readonly impersonation = inject(ImpersonationService);
  private readonly session = inject(SessionStore);
  private readonly publicConfig = inject(PublicConfigStore);

  /** B2: el ASESOR (no admin) NO ve ni puede abrir la tab "Sistema" (exclusiva admin). */
  protected readonly isAdvisor = computed(
    () => this.session.hasRole('advisor') && !this.session.hasRole('admin'),
  );
  protected readonly hideSystemTab = this.isAdvisor;
  /** Estado de desbloqueo del asesor (banner en la consola). */
  protected readonly advisorUnlock = signal<{ lockEnabled: boolean; unlocked: boolean; pending: boolean; expiresAt: string | null } | null>(null);
  protected readonly requestingUnlock = signal(false);
  private readonly theme = inject(ThemeService);
  private readonly toasts = inject(ToastService);

  /**
   * Settings que mapean a `PublicConfigStore` → togglearlos debe reflejarse YA en el
   * frontend (switcher de idioma / categorías del inicio) sin F5 (W2/W10).
   */
  private static readonly PUBLIC_CONFIG_SETTERS: Record<
    string,
    (store: PublicConfigStore, v: number | boolean | string) => void
  > = {
    'i18n.allow_visitor_switch': (s, v) => s.setAllowVisitorLangSwitch(Boolean(v)),
    'home.show_categories': (s, v) => s.setShowHomeCategories(Boolean(v)),
    'theme.slot.dia': (s, v) => s.setThemeSlot('dia', String(v)),
    'theme.slot.noche': (s, v) => s.setThemeSlot('noche', String(v)),
    'theme.allow_visitor_switch': (s, v) => s.setThemeAllowVisitorSwitch(Boolean(v)),
    'theme.auto_by_hour': (s, v) => s.setThemeAutoByHour(Boolean(v)),
    'premium.enabled': (s, v) => s.setPremiumEnabled(Boolean(v)),
    'premium.trial_enabled': (s, v) => s.setPremiumTrialEnabled(Boolean(v)),
    'premium.trial_days': (s, v) => s.setPremiumTrialDays(Number(v)),
    'chat.enabled': (s, v) => s.setChatEnabled(Boolean(v)),
  };
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly translate = inject(TranslateService);

  protected readonly tab = signal<AdminTab>('eventos');

  /** Tabs válidos para el deep-link `?tab=` (se restaura al recargar). */
  private static readonly TABS: AdminTab[] = [
    'eventos',
    'promotores',
    'salones',
    'plantillas',
    'sistema',
    'invitaciones',
  ];

  /** Etiqueta amigable de un setting (key con puntos → guion bajo). */
  protected settingLabel(key: string): string {
    return this.translate.instant('config.settingLabels.' + key.split('.').join('_'));
  }
  /** Descripción amigable de un setting (key con puntos → guion bajo). */
  protected settingDescription(key: string): string {
    return this.translate.instant('config.settingDescriptions.' + key.split('.').join('_'));
  }

  // --- Eventos ---
  protected readonly events = signal<AdminEventListItemDto[]>([]);
  /** Evento cuyo destacado se está guardando (deshabilita su check mientras). */
  protected readonly promotingId = signal<string | null>(null);
  protected readonly eventsPage = signal(1);
  protected readonly eventsPageSize = EVENTS_PAGE;
  protected readonly eventSearch = signal('');
  protected readonly eventStatus = signal('');
  /** Filtro por tiempo (futuros/en curso/pasados/todos). Default = futuros. */
  protected readonly eventTime = signal<EventTimeGroup>('upcoming');
  /** Opciones FIJAS del filtro de tiempo (label vía i18n). */
  protected readonly eventTimeOptions: { value: EventTimeGroup; key: string }[] = [
    { value: 'upcoming', key: 'config.events.timeUpcoming' },
    { value: 'ongoing', key: 'config.events.timeOngoing' },
    { value: 'past', key: 'config.events.timePast' },
    { value: 'all', key: 'common.all' },
  ];
  /** Filtro por promotor (id del promotor seleccionado; '' = todos). */
  protected readonly eventPromoter = signal('');
  /** Filtro por categoría: '' (todas) | 'none' (sin categoría) | <categoryId>. Detecta eventos sin categorizar. */
  protected readonly eventCategory = signal('');
  protected readonly eventPromoters = computed(() => {
    const map = new Map<string, string>();
    for (const e of this.events()) {
      if (!e.promoter) continue;
      map.set(e.promoter.id, `${e.promoter.firstName} ${e.promoter.lastName ?? ''}`.trim());
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  });
  /** Categorías presentes entre los eventos (para el filtro admin). */
  protected readonly eventCategories = computed(() => {
    const map = new Map<string, string>();
    for (const e of this.events()) {
      if (e.category) map.set(e.category.id, e.category.name);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  });
  protected readonly filteredEvents = computed(() => {
    const q = this.eventSearch().trim().toLowerCase();
    const status = this.eventStatus();
    const time = this.eventTime();
    const promoterId = this.eventPromoter();
    const cat = this.eventCategory();
    return this.events().filter((e) => {
      if (status && e.status !== status) return false;
      if (time !== 'all' && this.timeGroupOf(e) !== time) return false;
      if (promoterId && e.promoter?.id !== promoterId) return false;
      if (cat === 'none' && e.category) return false;
      if (cat && cat !== 'none' && e.category?.id !== cat) return false;
      if (!q) return true;
      const promoter = e.promoter
        ? `${e.promoter.firstName} ${e.promoter.lastName ?? ''}`.toLowerCase()
        : '';
      return e.name.toLowerCase().includes(q) || promoter.includes(q);
    });
  });
  protected readonly eventsTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredEvents().length / EVENTS_PAGE)),
  );
  protected readonly pageEvents = computed(() => {
    const start = (this.eventsPage() - 1) * EVENTS_PAGE;
    return this.filteredEvents().slice(start, start + EVENTS_PAGE);
  });

  /** Clasifica un evento del admin por tiempo (estado + fechas), como en el panel promotor. */
  private timeGroupOf(e: AdminEventListItemDto): Exclude<EventTimeGroup, 'all'> {
    if (e.status === 'finished' || e.status === 'cancelled') return 'past';
    const now = Date.now();
    const starts = new Date(e.startsAt).getTime();
    const ends = new Date(e.endsAt).getTime();
    if (!Number.isNaN(ends) && ends < now) return 'past';
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

  /** Abre el evento en la consola (vista de edición), como ADMIN (sin impersonar). */
  protected openEvent(id: string, tab?: string): void {
    void this.router.navigate(['/promotor/eventos', id, 'editar'], {
      queryParams: { from: 'admin', ...(tab ? { tab } : {}) },
    });
  }

  // --- Promotores ---
  protected readonly promoters = signal<PromoterListItemDto[]>([]);
  protected readonly promoterStatus = signal<string>('');
  protected readonly promoterSearch = signal<string>('');
  protected readonly notes = signal<Record<string, string>>({});
  protected readonly filteredPromoters = computed(() => {
    const q = this.promoterSearch().trim().toLowerCase();
    if (!q) return this.promoters();
    return this.promoters().filter((p) =>
      `${p.firstName} ${p.lastName ?? ''} ${p.email}`.toLowerCase().includes(q),
    );
  });

  // --- Sistema ---
  protected readonly gateways = signal<GatewayResponseDto[]>([]);
  protected readonly gatewayDraft = signal<GatewayDraft | null>(null);
  /** Buscador de pasarelas (filtro por nombre). */
  protected readonly gatewaySearch = signal('');
  protected readonly filteredGateways = computed(() => {
    const q = this.gatewaySearch().trim().toLowerCase();
    if (!q) return this.gateways();
    return this.gateways().filter(
      (g) => g.name.toLowerCase().includes(q) || (g.provider ?? '').toLowerCase().includes(q),
    );
  });

  // --- Invitaciones ---
  protected readonly showInviteForm = signal(false);
  protected readonly emailsText = signal('');
  protected readonly inviteTestUser = signal(false);
  protected readonly created = signal<CreatedInvitationDto[]>([]);
  protected readonly invitations = signal<InvitationListItemDto[]>([]);
  protected readonly inviting = signal(false);
  protected readonly invSearch = signal('');
  /** Filtro por estado; default = Pendientes (v3.8 · G2-6). '' = Todos. */
  protected readonly invFilterStatus = signal('pending');
  /** Opciones FIJAS del filtro (label capitalizado vía i18n). */
  protected readonly invFilterOptions: { value: string; key: string }[] = [
    { value: 'pending', key: 'config.invitations.filterPending' },
    { value: 'accepted', key: 'config.invitations.filterAuthorized' },
    { value: 'revoked', key: 'config.invitations.filterRejected' },
    { value: '', key: 'config.invitations.filterAll' },
  ];
  protected readonly filteredInvitations = computed(() => {
    const q = this.invSearch().trim().toLowerCase();
    const st = this.invFilterStatus();
    return this.invitations().filter((i) => {
      if (st && i.status !== st) return false;
      if (q && !i.email.toLowerCase().includes(q)) return false;
      return true;
    });
  });
  protected readonly invPage = signal(1);
  protected readonly invPageSize = INV_PAGE;
  protected readonly invTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredInvitations().length / INV_PAGE)),
  );
  protected readonly pageInvitations = computed(() => {
    const start = (this.invPage() - 1) * INV_PAGE;
    return this.filteredInvitations().slice(start, start + INV_PAGE);
  });
  protected goToInvPage(p: number): void {
    this.invPage.set(Math.min(Math.max(1, p), this.invTotalPages()));
  }
  protected setInvSearch(v: string): void {
    this.invSearch.set(v);
    this.invPage.set(1);
  }
  protected setInvFilter(v: string): void {
    this.invFilterStatus.set(v);
    this.invPage.set(1);
  }

  constructor() {
    // Deep-link REACTIVO a `?tab=`: al recargar se restaura el tab activo.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((pm) => {
      const t = pm.get('tab') as AdminTab | null;
      this.applyTab(t && ConfigPage.TABS.includes(t) ? t : 'eventos');
    });
    // B2: si es asesor, carga su estado de desbloqueo (banner en la consola).
    if (this.isAdvisor()) this.loadAdvisorUnlock();
  }

  private loadAdvisorUnlock(): void {
    this.advisorApi.status().subscribe({
      next: (s) => this.advisorUnlock.set({ lockEnabled: s.lockEnabled, unlocked: s.unlocked, pending: s.pending, expiresAt: s.expiresAt }),
      error: () => undefined,
    });
  }

  /** El asesor solicita desbloqueo (correo con enlace al admin). */
  protected requestAdvisorUnlock(): void {
    if (this.requestingUnlock()) return;
    this.requestingUnlock.set(true);
    this.advisorApi.requestUnlock().subscribe({
      next: () => {
        this.requestingUnlock.set(false);
        this.toasts.success(this.translate.instant('advisor.requestSent'));
        this.loadAdvisorUnlock();
      },
      error: () => {
        this.requestingUnlock.set(false);
        this.toasts.error(this.translate.instant('advisor.requestError'));
      },
    });
  }

  /** Fija el tab y hace la carga perezosa de sus datos (sin tocar la URL). */
  private applyTab(t: AdminTab): void {
    // B2: un asesor jamás entra a "Sistema" (aunque manipule el ?tab=). Cae a eventos.
    if (t === 'sistema' && this.hideSystemTab()) t = 'eventos';
    // Punto 9: cambiar de tab CIERRA cualquier form de pasarela (crear/editar).
    this.closeGatewayForms();
    // v3.8 · G2-3: cambiar de tab RESETEA los filtros a su vista por defecto.
    this.resetFilters();
    this.tab.set(t);
    if (t === 'eventos' && this.events().length === 0) this.loadEvents();
    if (t === 'promotores') this.loadPromoters();
    if (t === 'sistema' && this.settings().length === 0) this.loadSystem();
    if (t === 'invitaciones' && this.invitations().length === 0) this.loadInvitations();
  }

  /** Restaura TODOS los filtros/buscadores a su estado inicial (al cambiar de tab). */
  private resetFilters(): void {
    this.eventSearch.set('');
    this.eventStatus.set('');
    this.eventTime.set('upcoming');
    this.eventPromoter.set('');
    this.eventCategory.set('');
    this.eventsPage.set(1);
    this.promoterSearch.set('');
    this.promoterStatus.set('');
    this.gatewaySearch.set('');
    this.invSearch.set('');
    this.invFilterStatus.set('pending');
    this.invPage.set(1);
  }

  protected selectTab(t: AdminTab): void {
    this.applyTab(t);
    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: { tab: t === 'eventos' ? null : t },
        queryParamsHandling: 'merge',
      })
      .catch(() => undefined);
  }

  // --- Eventos ---
  private loadEvents(): void {
    this.admin.listAllEvents().subscribe({
      next: (e) => {
        this.events.set(e);
        this.eventsPage.set(1);
      },
      error: () => this.toasts.error(this.translate.instant('config.events.loadError')),
    });
  }

  /**
   * Destaca/quita un evento del slider del inicio (solo admin). Actualiza el estado local
   * del item para reflejar el check al instante. El slider solo muestra futuros publicados
   * destacados y se oculta si no hay ninguno.
   */
  protected togglePromoted(e: AdminEventListItemDto, featured: boolean): void {
    this.promotingId.set(e.id);
    this.promoterEvents.promote(e.id, featured).subscribe({
      next: () => {
        this.events.update((list) =>
          list.map((x) => (x.id === e.id ? { ...x, promotedPriority: featured ? 0 : null } : x)),
        );
        this.promotingId.set(null);
        this.toasts.success(
          this.translate.instant(featured ? 'config.events.featured' : 'config.events.unfeatured'),
        );
      },
      error: () => {
        this.promotingId.set(null);
        this.toasts.error(this.translate.instant('config.events.featureError'));
      },
    });
  }

  protected goToEventsPage(p: number): void {
    this.eventsPage.set(Math.min(Math.max(1, p), this.eventsTotalPages()));
  }
  protected setEventSearch(v: string): void {
    this.eventSearch.set(v);
    this.eventsPage.set(1);
  }
  protected setEventStatus(v: string): void {
    this.eventStatus.set(v);
    this.eventsPage.set(1);
  }
  protected setEventTime(v: EventTimeGroup): void {
    this.eventTime.set(v);
    this.eventsPage.set(1);
  }
  protected setEventPromoter(v: string): void {
    this.eventPromoter.set(v);
    this.eventsPage.set(1);
  }
  protected setEventCategory(v: string): void {
    this.eventCategory.set(v);
    this.eventsPage.set(1);
  }

  // --- Promotores ---
  /** Reparto (cost-share) por promotor: override crudo + % efectivo. */
  protected readonly costShareMap = signal<Record<string, { override: number | null; effectivePct: number }>>({});
  /** Borrador editable del reparto por promotor (string del input). */
  protected readonly pctEdits = signal<Record<string, string>>({});

  protected loadPromoters(): void {
    this.admin.listPromoters(this.promoterStatus() || undefined).subscribe({
      next: (p) => {
        this.promoters.set(p);
        // Prefija las notas internas persistidas (v3.8 · G2-9).
        this.notes.set(Object.fromEntries(p.map((x) => [x.id, x.promoterInternalNote ?? ''])));
        this.loadCostShares(p);
      },
      error: () => this.toasts.error(this.translate.instant('config.promoters.loadError')),
    });
  }
  /** Carga el reparto efectivo de cada promotor listado (para prefijar el input). */
  private loadCostShares(promoters: PromoterListItemDto[]): void {
    for (const p of promoters) {
      this.admin.getPromoterCostShare(p.id).subscribe({
        next: (cs) => {
          this.costShareMap.update((m) => ({ ...m, [p.id]: { override: cs.override, effectivePct: cs.effectivePct } }));
          this.pctEdits.update((e) => ({ ...e, [p.id]: cs.override != null ? String(cs.override) : '' }));
        },
        error: () => undefined,
      });
    }
  }
  protected setNote(id: string, value: string): void {
    this.notes.update((n) => ({ ...n, [id]: value }));
  }
  private noteFor(id: string): string | undefined {
    return this.notes()[id]?.trim() || undefined;
  }
  /** Guarda la nota interna del promotor (persiste en BD, v3.8 · G2-9). */
  protected saveNote(p: PromoterListItemDto): void {
    this.admin.setPromoterNote(p.id, this.notes()[p.id]?.trim() ?? '').subscribe({
      next: () => this.toasts.success(this.translate.instant('config.promoters.noteSaved')),
      error: () => this.toasts.error(this.translate.instant('config.promoters.noteError')),
    });
  }
  protected setPctEdit(id: string, value: string): void {
    this.pctEdits.update((e) => ({ ...e, [id]: value }));
  }
  protected effectivePct(id: string): number | null {
    return this.costShareMap()[id]?.effectivePct ?? null;
  }
  protected hasOverride(id: string): boolean {
    return this.costShareMap()[id]?.override != null;
  }

  // --- Aprobar / reactivar / rechazar con confirmación (v3.8 · G2-5) ---
  protected askApprove(p: PromoterListItemDto): void {
    const reactivate = p.promoterStatus === 'suspended';
    this.confirm.ask({
      title: this.translate.instant(reactivate ? 'config.promoters.reactivateConfirmTitle' : 'config.promoters.approveConfirmTitle', { name: p.firstName }),
      message: this.translate.instant(reactivate ? 'config.promoters.reactivateConfirmMsg' : 'config.promoters.approveConfirmMsg', { name: p.firstName }),
      confirmLabel: this.translate.instant(reactivate ? 'config.promoters.reactivate' : 'config.promoters.approve'),
      confirmIcon: reactivate ? 'reactivate' : 'save',
      titleIcon: reactivate ? 'reactivate' : 'save',
      danger: false,
      auditAction: reactivate ? 'promoter.reactivate' : 'promoter.approve',
      auditResource: p.id,
      onConfirm: () => this.approve(p),
    });
  }
  protected approve(p: PromoterListItemDto): void {
    this.admin.approvePromoter(p.id).subscribe({
      next: () => {
        this.toasts.success(this.translate.instant('config.promoters.approved', { name: p.firstName }));
        this.loadPromoters();
      },
      error: () => this.toasts.error(this.translate.instant('config.promoters.approveError')),
    });
  }
  protected askReject(p: PromoterListItemDto): void {
    this.confirm.ask({
      title: this.translate.instant('config.promoters.rejectConfirmTitle', { name: p.firstName }),
      message: this.translate.instant('config.promoters.rejectConfirmMsg', { name: p.firstName }),
      confirmLabel: this.translate.instant('config.promoters.reject'),
      confirmIcon: 'cancel',
      danger: true,
      auditAction: 'promoter.reject',
      auditResource: p.id,
      onConfirm: () => this.reject(p),
    });
  }
  protected reject(p: PromoterListItemDto): void {
    this.admin.rejectPromoter(p.id, this.noteFor(p.id)).subscribe({
      next: () => {
        this.toasts.info(this.translate.instant('config.promoters.rejected', { name: p.firstName }));
        this.loadPromoters();
      },
      error: () => this.toasts.error(this.translate.instant('config.promoters.rejectError')),
    });
  }

  // --- Impersonación de soporte (v3.8 · G2-4) ---
  protected askImpersonate(p: PromoterListItemDto): void {
    if (p.promoterStatus !== 'approved') {
      this.toasts.warning(this.translate.instant('config.promoters.impersonateOnlyApproved'));
      return;
    }
    this.confirm.ask({
      title: this.translate.instant('config.promoters.impersonateConfirmTitle', { name: p.firstName }),
      message: this.translate.instant('config.promoters.impersonateConfirmMsg', { name: p.firstName }),
      confirmLabel: this.translate.instant('config.promoters.impersonateStart'),
      confirmIcon: 'view',
      titleIcon: 'view',
      danger: false,
      auditAction: 'admin.impersonate',
      auditResource: p.id,
      onConfirm: () => this.impersonate(p),
    });
  }
  protected impersonate(p: PromoterListItemDto): void {
    this.impersonation.start(p.id).subscribe({
      next: () => {
        this.toasts.info(this.translate.instant('config.promoters.impersonateStarted', { name: p.firstName }));
        void this.router.navigateByUrl('/promotor');
      },
      error: () => this.toasts.error(this.translate.instant('config.promoters.impersonateError')),
    });
  }

  // --- Suspensión con modal + motivo ---
  protected readonly suspendTarget = signal<PromoterListItemDto | null>(null);
  protected readonly suspendReason = signal('');
  protected openSuspend(p: PromoterListItemDto): void {
    this.suspendTarget.set(p);
    this.suspendReason.set('');
  }
  protected cancelSuspend(): void {
    this.suspendTarget.set(null);
  }
  protected confirmSuspend(): void {
    const p = this.suspendTarget();
    if (!p) return;
    // Bitácora de no-repudio (v3.8 · G4): el modal de suspender no usa el
    // confirm-dialog (lleva motivo), así que registramos el click a mano.
    this.audit.confirm('promoter.suspend', p.id).subscribe({ error: () => undefined });
    this.admin.suspendPromoter(p.id, this.suspendReason().trim() || undefined).subscribe({
      next: () => {
        this.toasts.info(this.translate.instant('config.promoters.suspended', { name: p.firstName }));
        this.suspendTarget.set(null);
        this.loadPromoters();
      },
      error: () => this.toasts.error(this.translate.instant('config.promoters.suspendError')),
    });
  }

  // --- Historial de estados → PÁGINA dedicada. ---
  protected openHistory(p: PromoterListItemDto): void {
    void this.router.navigate(['/configuracion/promotores', p.id, 'historial'], {
      queryParams: { name: `${p.firstName} ${p.lastName ?? ''}`.trim() },
    });
  }
  protected setPromoterPct(p: PromoterListItemDto): void {
    const raw = String(this.pctEdits()[p.id] ?? '').trim();
    const pct = Number(raw);
    if (raw === '' || Number.isNaN(pct) || pct < 0 || pct > 1) {
      this.toasts.warning(this.translate.instant('config.promoters.shareRange'));
      return;
    }
    this.admin.setPromoterPct(p.id, pct).subscribe({
      next: () => {
        this.toasts.success(this.translate.instant('config.promoters.shareUpdated'));
        this.refreshCostShare(p.id);
      },
      error: () => this.toasts.error(this.translate.instant('config.promoters.shareError')),
    });
  }
  /** Restablece el reparto del promotor al default global (DELETE del override). */
  protected resetPromoterPct(p: PromoterListItemDto): void {
    this.admin.resetPromoterCostShare(p.id).subscribe({
      next: () => {
        this.toasts.info(this.translate.instant('config.promoters.shareResetDone'));
        this.refreshCostShare(p.id);
      },
      error: () => this.toasts.error(this.translate.instant('config.promoters.shareError')),
    });
  }
  private refreshCostShare(id: string): void {
    this.admin.getPromoterCostShare(id).subscribe({
      next: (cs) => {
        this.costShareMap.update((m) => ({ ...m, [id]: { override: cs.override, effectivePct: cs.effectivePct } }));
        this.pctEdits.update((e) => ({ ...e, [id]: cs.override != null ? String(cs.override) : '' }));
      },
      error: () => undefined,
    });
  }

  // --- Sistema ---
  // "Autorización de promotores" y "Reparto de gastos por defecto" YA NO tienen bloque
  // propio: son settings normales del catálogo (`promoters.require_approval` bool y
  // `costshare.default_pct` pct), editables en el grid. El tab Sistema arranca por las
  // PASARELAS (arriba) y luego el grid de configuraciones.
  private loadSystem(): void {
    this.loadGateways();
    this.loadSettings();
  }
  private loadGateways(): void {
    this.admin.listGateways().subscribe({
      next: (g) => this.gateways.set(g),
      error: () => this.gateways.set([]),
    });
  }

  // Pasarelas — edición
  protected editGateway(g: GatewayResponseDto): void {
    // Bloqueado: solo se puede "definir default"; editar exige desbloquear (OTP).
    if (!this.unlockUnlocked()) return;
    this.gatewayDraft.set({
      id: g.id,
      name: g.name,
      feePct: Number(g.feePct),
      transactionFixedFee: Number(g.transactionFixedFee),
      minCostSharePct: Number(g.minCostSharePct),
      installmentFixedFee: Number(g.installmentFixedFee ?? 0),
      installmentRatesJson: g.installmentRates ? JSON.stringify(g.installmentRates) : '',
      installmentsEnabled: g.installmentsEnabled ?? true,
      status: g.status,
    });
  }
  protected cancelGatewayEdit(): void {
    this.gatewayDraft.set(null);
  }
  protected patchDraft<K extends keyof GatewayDraft>(key: K, value: GatewayDraft[K]): void {
    const d = this.gatewayDraft();
    if (d) this.gatewayDraft.set({ ...d, [key]: value });
  }
  protected saveGateway(): void {
    const d = this.gatewayDraft();
    if (!d || !this.unlockUnlocked()) return; // guardar exige desbloqueo
    let installmentRates: Record<string, number> | undefined;
    if (d.installmentRatesJson.trim()) {
      try {
        installmentRates = JSON.parse(d.installmentRatesJson) as Record<string, number>;
      } catch {
        this.toasts.warning(this.translate.instant('config.system.ratesJsonInvalid'));
        return;
      }
    }
    this.admin
      .updateGateway(d.id, {
        name: d.name,
        feePct: d.feePct,
        transactionFixedFee: d.transactionFixedFee,
        minCostSharePct: d.minCostSharePct,
        installmentFixedFee: d.installmentFixedFee,
        installmentRates,
        installmentsEnabled: d.installmentsEnabled,
      })
      .subscribe({
        next: () => {
          this.toasts.success(this.translate.instant('config.system.gatewayUpdated'));
          this.gatewayDraft.set(null);
          this.loadGateways();
        },
        error: () => this.toasts.error(this.translate.instant('config.system.gatewayUpdateError')),
      });
  }
  protected setGatewayStatus(g: GatewayResponseDto, status: string): void {
    this.admin.setGatewayStatus(g.id, status).subscribe({
      next: () => {
        this.toasts.success(this.translate.instant('config.system.gatewayStatusUpdated'));
        this.loadGateways();
      },
      error: () => this.toasts.error(this.translate.instant('config.system.gatewayStatusError')),
    });
  }
  protected makeDefault(g: GatewayResponseDto): void {
    this.admin.makeGatewayDefault(g.id).subscribe({
      next: () => {
        this.toasts.success(this.translate.instant('config.system.gatewayDefaultSet', { name: g.name }));
        this.loadGateways();
      },
      error: () => this.toasts.error(this.translate.instant('config.system.gatewayDefaultError')),
    });
  }
  /** Solo se elimina una pasarela INACTIVA no-default (el backend lo valida). */
  protected canDeleteGateway(g: GatewayResponseDto): boolean {
    return g.status === 'inactive' && !g.isPlatformDefault;
  }
  protected askRemoveGateway(g: GatewayResponseDto): void {
    if (!this.canDeleteGateway(g)) {
      this.toasts.warning(this.translate.instant('config.system.deleteGatewayBlockedTitle'));
      return;
    }
    this.confirm.ask({
      title: this.translate.instant('config.system.gwRemoveConfirmTitle'),
      message: this.translate.instant('config.system.gwRemoveConfirmMessage', { name: g.name }),
      confirmLabel: this.translate.instant('common.delete'),
      confirmIcon: 'delete',
      onConfirm: () =>
        this.admin.deleteGateway(g.id).subscribe({
          next: () => {
            this.toasts.info(this.translate.instant('config.system.gatewayRemoved'));
            this.gatewayDraft.set(null);
            this.loadGateways();
          },
          error: () => this.toasts.error(this.translate.instant('config.system.gatewayRemoveError')),
        }),
    });
  }

  // --- Agregar pasarela (acción sensible: candado + modal + OTP) ---
  protected readonly lockModalOpen = signal(false); // modal explicativo del candado
  protected readonly unlockSent = signal(false); // OTP enviado al correo
  protected readonly unlockUnlocked = signal(false); // autorizado → botón "Agregar" habilitado
  protected readonly showCreateForm = signal(false); // form de creación visible
  protected readonly unlockCode = signal('');
  protected readonly newGateway = signal<NewGatewayDraft>({
    name: '',
    provider: 'pagalo',
    feePct: 0.03,
    transactionFixedFee: 0,
  });
  protected patchNewGateway<K extends keyof NewGatewayDraft>(key: K, value: NewGatewayDraft[K]): void {
    this.newGateway.set({ ...this.newGateway(), [key]: value });
  }
  /** Cierra todos los estados de forms de pasarela (al cambiar de tab, punto 9). */
  private closeGatewayForms(): void {
    this.gatewayDraft.set(null);
    this.showCreateForm.set(false);
    this.lockModalOpen.set(false);
  }
  /** Abre el modal explicativo del candado (acción sensible). */
  protected openLockModal(): void {
    this.lockModalOpen.set(true);
  }
  protected closeLockModal(): void {
    this.lockModalOpen.set(false);
  }
  /** Dentro del modal: pide el OTP al correo del admin. */
  protected requestUnlock(): void {
    this.admin.unlockGateway().subscribe({
      next: () => {
        this.unlockSent.set(true);
        this.toasts.info(this.translate.instant('config.system.unlockSentToast'));
      },
      error: () => this.toasts.error(this.translate.instant('config.system.unlockSendError')),
    });
  }
  /** Confirma el código: autoriza (candado desaparece, botón "Agregar" habilitado). */
  protected confirmUnlock(): void {
    if (this.unlockCode().trim().length < 6) {
      this.toasts.warning(this.translate.instant('config.system.unlockCodeRequired'));
      return;
    }
    this.unlockUnlocked.set(true);
    this.lockModalOpen.set(false);
  }
  /** Cancela/limpia todo el flujo de desbloqueo. */
  protected cancelUnlock(): void {
    this.lockModalOpen.set(false);
    this.unlockSent.set(false);
    this.unlockUnlocked.set(false);
    this.showCreateForm.set(false);
    this.unlockCode.set('');
  }
  /** Ya autorizado: abre el formulario de creación. */
  protected openCreateForm(): void {
    if (!this.unlockUnlocked()) return;
    this.showCreateForm.set(true);
  }
  /** Crea la pasarela con el código OTP (el backend lo valida/consume). */
  protected createGateway(): void {
    const g = this.newGateway();
    if (!g.name.trim()) {
      this.toasts.warning(this.translate.instant('config.system.gatewayNameRequired'));
      return;
    }
    this.admin
      .createGateway({
        unlockCode: this.unlockCode().trim(),
        name: g.name.trim(),
        provider: g.provider.trim() || 'pagalo',
        feePct: g.feePct,
        transactionFixedFee: g.transactionFixedFee,
        sandbox: false,
      })
      .subscribe({
        next: () => {
          this.toasts.success(this.translate.instant('config.system.gatewayAdded', { name: g.name }));
          this.cancelUnlock();
          this.newGateway.set({ name: '', provider: 'pagalo', feePct: 0.03, transactionFixedFee: 0 });
          this.loadGateways();
        },
        error: () => this.toasts.error(this.translate.instant('config.system.gatewayAddError')),
      });
  }

  // --- Invitaciones ---
  private loadInvitations(): void {
    this.invitationsApi.list().subscribe({
      next: (i) => this.invitations.set(i),
      error: () => this.invitations.set([]),
    });
  }
  protected readonly parsedEmails = computed(() =>
    this.emailsText()
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter(Boolean),
  );
  private static readonly EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  protected readonly invalidEmails = computed(() =>
    this.parsedEmails().filter((e) => !ConfigPage.EMAIL_RE.test(e)),
  );
  protected onInviteButton(): void {
    if (!this.showInviteForm()) {
      this.showInviteForm.set(true);
      return;
    }
    this.invite();
  }
  protected cancelInvite(): void {
    this.showInviteForm.set(false);
    this.emailsText.set('');
    this.inviteTestUser.set(false);
  }
  protected invite(): void {
    const emails = this.parsedEmails();
    if (emails.length === 0) {
      this.toasts.warning(this.translate.instant('config.invitations.atLeastOneEmail'));
      return;
    }
    const invalid = this.invalidEmails();
    if (invalid.length > 0) {
      this.toasts.warning(
        this.translate.instant('config.invitations.invalidEmail', { emails: invalid.join(', ') }),
      );
      return;
    }
    this.inviting.set(true);
    this.invitationsApi.create(emails, this.inviteTestUser()).subscribe({
      next: (res) => {
        this.inviting.set(false);
        this.created.set(res.invitations);
        this.emailsText.set('');
        this.inviteTestUser.set(false);
        this.showInviteForm.set(false);
        this.toasts.success(this.translate.instant('config.invitations.generated', { n: res.invitations.length }));
        this.loadInvitations();
      },
      error: () => {
        this.inviting.set(false);
        this.toasts.error(this.translate.instant('config.invitations.createError'));
      },
    });
  }

  // --- Configuraciones del sistema (catálogo) — dentro del tab Sistema ---
  protected readonly settings = signal<SettingViewDto[]>([]);
  protected readonly settingEdits = signal<Record<string, number | boolean | string>>({});
  /** false hasta que la 1ª carga resuelve o falla → distingue "cargando" de "vacío". */
  protected readonly settingsLoaded = signal(false);
  private loadSettings(): void {
    this.settingsApi.list().subscribe({
      next: (s) => {
        this.settings.set(s);
        this.settingEdits.set(Object.fromEntries(s.map((x) => [x.key, x.value])));
        this.settingsLoaded.set(true);
      },
      error: () => {
        this.settingsLoaded.set(true);
        this.toasts.error(this.translate.instant('config.settings.loadError'));
      },
    });
  }
  protected setSettingValue(key: string, value: number | boolean | string): void {
    this.settingEdits.update((e) => ({ ...e, [key]: value }));
  }
  /** ¿El valor editado difiere del guardado? (habilita el botón Guardar). */
  protected settingDirty(s: SettingViewDto): boolean {
    return this.settingEdits()[s.key] !== s.value;
  }

  /** Etiqueta traducible de una opción de un setting enum (p.ej. temas / franjas). */
  protected settingOptionLabel(key: string, opt: string): string {
    const label = this.translate.instant('config.settingOptions.' + opt);
    return label === 'config.settingOptions.' + opt ? opt : label;
  }

  // --- Vista previa de temas (collapsable al final de Sistema) ---
  /** Temas registrados = opciones del setting enum de franja (en sync con el backend). */
  protected readonly themeKeys = computed<string[]>(() => {
    const s = this.settings().find((x) => x.key === 'theme.slot.noche');
    return (s?.options ?? []) as string[];
  });
  /** Tema actualmente aplicado (para marcar "activo" en la vista previa). */
  protected readonly themeActive = computed(() => this.theme.theme());
  /** A qué franja(s) está asignado un tema (según lo editado en el grid). */
  protected themeAssignedLabel(themeKey: string): string {
    const dia = this.settingEdits()['theme.slot.dia'];
    const noche = this.settingEdits()['theme.slot.noche'];
    const parts: string[] = [];
    if (dia === themeKey) parts.push(this.translate.instant('config.settingOptions.dia'));
    if (noche === themeKey) parts.push(this.translate.instant('config.settingOptions.noche'));
    return parts.length ? parts.join(' · ') : this.translate.instant('config.themePreview.unassigned');
  }
  protected saveSetting(s: SettingViewDto): void {
    const value = this.settingEdits()[s.key];
    this.settingsApi.update(s.key, value).subscribe({
      next: (updated) => {
        this.settings.update((list) => list.map((x) => (x.key === updated.key ? updated : x)));
        // W2/W10: si el setting mapea a la config pública, refleja el cambio al
        // instante en el store (switcher/categorías) sin recargar la página.
        const setter = ConfigPage.PUBLIC_CONFIG_SETTERS[updated.key];
        if (setter) setter(this.publicConfig, updated.value);
        this.toasts.success(this.translate.instant('config.settings.saved', { key: s.key }));
      },
      error: () => this.toasts.error(this.translate.instant('config.settings.saveError')),
    });
  }

  // --- Confirmación de acciones destructivas ---
  protected readonly confirm = new ConfirmController();

  protected askRevoke(i: InvitationListItemDto): void {
    this.confirm.ask({
      title: this.translate.instant('config.invitations.revokeConfirmTitle'),
      message: this.translate.instant('config.invitations.revokeConfirmMessage', { email: i.email }),
      confirmLabel: this.translate.instant('config.invitations.revoke'),
      confirmIcon: 'revoke',
      onConfirm: () => this.revoke(i),
    });
  }

  protected revoke(i: InvitationListItemDto): void {
    this.invitationsApi.revoke(i.id).subscribe({
      next: () => {
        this.toasts.info(this.translate.instant('config.invitations.revoked'));
        this.loadInvitations();
      },
      error: () => this.toasts.error(this.translate.instant('config.invitations.revokeError')),
    });
  }
}
