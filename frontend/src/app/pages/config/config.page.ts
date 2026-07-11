import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocalizedDatePipe } from '../../core/i18n/localized-date.pipe';
import {
  AdminApi,
  AdminEventListItemDto,
  GatewayResponseDto,
  PromoterListItemDto,
} from '../../core/api/admin.api';
import { InvitationsApi } from '../../core/api/invitations.api';
import { HallsApi } from '../../core/api/halls.api';
import { SeatTemplatesApi } from '../../core/api/seat-templates.api';
import { SettingsApi } from '../../core/api/settings.api';
import { ToastService } from '../../core/ui/toast.service';
import {
  ConfirmDialogComponent,
  type ConfirmRequest,
} from '../../shared/confirm-dialog/confirm-dialog.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { MapPickerComponent, type MapLocation } from '../../shared/map/map-picker.component';
import { PagerComponent } from '../../shared/ui/pager.component';
import type {
  CreatedInvitationDto,
  HallResponseDto,
  InvitationListItemDto,
  SeatTemplateResponseDto,
  SettingViewDto,
} from '../../core/api/types';

type AdminTab =
  | 'eventos'
  | 'promotores'
  | 'sistema'
  | 'invitaciones'
  | 'salones'
  | 'plantillas'
  | 'ajustes';

/** Borrador editable de un salón (crear/editar con ubicación en mapa). */
interface HallDraft {
  id: string | null;
  name: string;
  address: string;
  city: string;
  notes: string;
  lat: number | null;
  lng: number | null;
}

/** Borrador editable de una plantilla de asientos. */
interface TemplateDraft {
  id: string | null;
  name: string;
  kind: string;
  paramsJson: string;
}

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
  status: string;
}

const EVENTS_PAGE = 12;
const INV_PAGE = 9;

/**
 * Consola de administración (F-v3, SOLO admin — roleGuard admin). Tabs: Eventos
 * (todos, grid + cuentas por evento), Promotores (búsqueda/filtro + edición
 * contextual con nota y cost-share), Sistema (pasarelas editables + default +
 * cost-share default + modo pruebas) e Invitaciones (invitar promotores, exclusivo
 * admin). El panel del promotor vive en /promotor (separado de verdad).
 */
@Component({
  selector: 'app-config-page',
  imports: [
    FormsModule,
    TranslatePipe,
    LocalizedDatePipe,
    IconComponent,
    ConfirmDialogComponent,
    PagerComponent,
    MapPickerComponent,
  ],
  templateUrl: './config.page.html',
})
export class ConfigPage {
  private readonly admin = inject(AdminApi);
  private readonly invitationsApi = inject(InvitationsApi);
  private readonly hallsApi = inject(HallsApi);
  private readonly templatesApi = inject(SeatTemplatesApi);
  private readonly settingsApi = inject(SettingsApi);
  private readonly toasts = inject(ToastService);
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
    'ajustes',
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
  protected readonly eventsPage = signal(1);
  protected readonly eventsPageSize = EVENTS_PAGE;
  protected readonly eventSearch = signal('');
  protected readonly eventStatus = signal('');
  /** Filtro por promotor (point 8): id del promotor seleccionado ('' = todos). */
  protected readonly eventPromoter = signal('');
  /** Promotores presentes en los eventos (para el selector de filtro). */
  protected readonly eventPromoters = computed(() => {
    const map = new Map<string, string>();
    for (const e of this.events()) {
      map.set(e.promoter.id, `${e.promoter.firstName} ${e.promoter.lastName ?? ''}`.trim());
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  });
  protected readonly filteredEvents = computed(() => {
    const q = this.eventSearch().trim().toLowerCase();
    const status = this.eventStatus();
    const promoterId = this.eventPromoter();
    return this.events().filter((e) => {
      if (status && e.status !== status) return false;
      if (promoterId && e.promoter.id !== promoterId) return false;
      if (!q) return true;
      const promoter = `${e.promoter.firstName} ${e.promoter.lastName ?? ''}`.toLowerCase();
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
  protected readonly requireApproval = signal<boolean | null>(null);
  protected readonly defaultPct = signal<number | null>(null);
  protected readonly gateways = signal<GatewayResponseDto[]>([]);
  protected readonly gatewayDraft = signal<GatewayDraft | null>(null);
  /** Buscador de pasarelas (regla v3.2: filtro por nombre). */
  protected readonly gatewaySearch = signal('');
  protected readonly filteredGateways = computed(() => {
    const q = this.gatewaySearch().trim().toLowerCase();
    if (!q) return this.gateways();
    return this.gateways().filter(
      (g) => g.name.toLowerCase().includes(q) || (g.provider ?? '').toLowerCase().includes(q),
    );
  });

  // --- Invitaciones ---
  /** El formulario de invitar está OCULTO por defecto; el botón "Invitar" lo alterna. */
  protected readonly showInviteForm = signal(false);
  protected readonly emailsText = signal('');
  protected readonly inviteTestUser = signal(false);
  protected readonly created = signal<CreatedInvitationDto[]>([]);
  protected readonly invitations = signal<InvitationListItemDto[]>([]);
  protected readonly inviting = signal(false);
  /** Búsqueda + filtro de estado de invitaciones (regla v3.2). */
  protected readonly invSearch = signal('');
  protected readonly invFilterStatus = signal('');
  protected readonly invStatuses = computed(() => [...new Set(this.invitations().map((i) => i.status))]);
  protected readonly filteredInvitations = computed(() => {
    const q = this.invSearch().trim().toLowerCase();
    const st = this.invFilterStatus();
    return this.invitations().filter((i) => {
      if (st && i.status !== st) return false;
      if (q && !i.email.toLowerCase().includes(q)) return false;
      return true;
    });
  });
  /** Paginación del grid de invitaciones (regla v3.2). */
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
    // Deep-link REACTIVO a `?tab=`: al recargar (o al navegar cambiando el query)
    // se restaura el tab activo. Es la única fuente de la carga inicial.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((pm) => {
      const t = pm.get('tab') as AdminTab | null;
      this.applyTab(t && ConfigPage.TABS.includes(t) ? t : 'eventos');
    });
  }

  /** Fija el tab y hace la carga perezosa de sus datos (sin tocar la URL). */
  private applyTab(t: AdminTab): void {
    this.tab.set(t);
    if (t === 'eventos' && this.events().length === 0) this.loadEvents();
    if (t === 'promotores' && this.promoters().length === 0) this.loadPromoters();
    if (t === 'sistema' && this.requireApproval() === null) this.loadSystem();
    if (t === 'invitaciones' && this.invitations().length === 0) this.loadInvitations();
    if (t === 'salones' && this.halls().length === 0) this.loadHalls();
    if (t === 'plantillas' && this.templates().length === 0) this.loadTemplates();
    if (t === 'ajustes' && this.settings().length === 0) this.loadSettings();
  }

  protected selectTab(t: AdminTab): void {
    this.applyTab(t); // respuesta inmediata del tab (y para tests)
    // Refleja el tab en la URL (`?tab=`) para que sobreviva a la recarga. La
    // suscripción de arriba re-aplica (idempotente). 'eventos' = sin query (limpio).
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
  protected setEventPromoter(v: string): void {
    this.eventPromoter.set(v);
    this.eventsPage.set(1);
  }

  // --- Promotores ---
  protected loadPromoters(): void {
    this.admin.listPromoters(this.promoterStatus() || undefined).subscribe({
      next: (p) => this.promoters.set(p),
      error: () => this.toasts.error(this.translate.instant('config.promoters.loadError')),
    });
  }
  protected setNote(id: string, value: string): void {
    this.notes.update((n) => ({ ...n, [id]: value }));
  }
  private noteFor(id: string): string | undefined {
    return this.notes()[id]?.trim() || undefined;
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
  protected reject(p: PromoterListItemDto): void {
    this.admin.rejectPromoter(p.id, this.noteFor(p.id)).subscribe({
      next: () => {
        this.toasts.info(this.translate.instant('config.promoters.rejected', { name: p.firstName }));
        this.loadPromoters();
      },
      error: () => this.toasts.error(this.translate.instant('config.promoters.rejectError')),
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
    this.admin.suspendPromoter(p.id, this.suspendReason().trim() || undefined).subscribe({
      next: () => {
        this.toasts.info(this.translate.instant('config.promoters.suspended', { name: p.firstName }));
        this.suspendTarget.set(null);
        this.loadPromoters();
      },
      error: () => this.toasts.error(this.translate.instant('config.promoters.suspendError')),
    });
  }

  // --- Historial de estados (append-only) → PÁGINA dedicada (filtrar/buscar). ---
  protected openHistory(p: PromoterListItemDto): void {
    void this.router.navigate(['/configuracion/promotores', p.id, 'historial'], {
      queryParams: { name: `${p.firstName} ${p.lastName ?? ''}`.trim() },
    });
  }
  protected setPromoterPct(p: PromoterListItemDto, value: string): void {
    const pct = Number(value);
    if (Number.isNaN(pct) || pct < 0 || pct > 1) {
      this.toasts.warning(this.translate.instant('config.promoters.shareRange'));
      return;
    }
    this.admin.setPromoterPct(p.id, pct).subscribe({
      next: () => this.toasts.success(this.translate.instant('config.promoters.shareUpdated')),
      error: () => this.toasts.error(this.translate.instant('config.promoters.shareError')),
    });
  }

  // --- Sistema ---
  private loadSystem(): void {
    this.admin.getRequireApproval().subscribe({
      next: (r) => this.requireApproval.set(r.requireApproval),
      error: () => this.requireApproval.set(null),
    });
    this.admin.getDefaultPct().subscribe({
      next: (r) => this.defaultPct.set(r.defaultPct),
      error: () => this.defaultPct.set(null),
    });
    this.loadGateways();
  }
  private loadGateways(): void {
    this.admin.listGateways().subscribe({
      next: (g) => this.gateways.set(g),
      error: () => this.gateways.set([]),
    });
  }
  protected toggleRequireApproval(): void {
    const next = !this.requireApproval();
    this.admin.setRequireApproval(next).subscribe({
      next: (r) => {
        this.requireApproval.set(r.requireApproval);
        this.toasts.success(
          this.translate.instant(next ? 'config.system.approvalRequired' : 'config.system.testModeOn'),
        );
      },
      error: () => this.toasts.error(this.translate.instant('config.system.approvalError')),
    });
  }
  protected saveDefaultPct(value: string): void {
    const pct = Number(value);
    if (Number.isNaN(pct) || pct < 0 || pct > 1) {
      this.toasts.warning(this.translate.instant('config.system.defaultShareRange'));
      return;
    }
    this.admin.setDefaultPct(pct).subscribe({
      next: () => {
        this.defaultPct.set(pct);
        this.toasts.success(this.translate.instant('config.system.defaultShareUpdated'));
      },
      error: () => this.toasts.error(this.translate.instant('config.system.defaultShareError')),
    });
  }

  // Pasarelas
  protected editGateway(g: GatewayResponseDto): void {
    this.gatewayDraft.set({
      id: g.id,
      name: g.name,
      feePct: Number(g.feePct),
      transactionFixedFee: Number(g.transactionFixedFee),
      minCostSharePct: Number(g.minCostSharePct),
      installmentFixedFee: Number(g.installmentFixedFee ?? 0),
      installmentRatesJson: g.installmentRates ? JSON.stringify(g.installmentRates) : '',
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
    if (!d) return;
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

  // --- Agregar pasarela (acción sensible: desbloqueo por OTP) ---
  protected readonly unlockSent = signal(false); // true tras pedir el código
  protected readonly unlockUnlocked = signal(false); // true tras ingresar un código
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
  /** "Desbloquear agregado": pide el OTP al correo del admin. */
  protected requestUnlock(): void {
    this.admin.unlockGateway().subscribe({
      next: () => {
        this.unlockSent.set(true);
        this.toasts.info(this.translate.instant('config.system.unlockSentToast'));
      },
      error: () => this.toasts.error(this.translate.instant('config.system.unlockSendError')),
    });
  }
  /** Confirma el código (habilita el formulario de creación). */
  protected confirmUnlock(): void {
    if (this.unlockCode().trim().length < 6) {
      this.toasts.warning(this.translate.instant('config.system.unlockCodeRequired'));
      return;
    }
    this.unlockUnlocked.set(true);
  }
  protected cancelUnlock(): void {
    this.unlockSent.set(false);
    this.unlockUnlocked.set(false);
    this.unlockCode.set('');
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
  /** Regex simple de formato de correo (validación client-side previa al backend). */
  private static readonly EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  /** Correos con formato inválido dentro de lo tecleado (para bloquear el envío). */
  protected readonly invalidEmails = computed(() =>
    this.parsedEmails().filter((e) => !ConfigPage.EMAIL_RE.test(e)),
  );
  /**
   * Botón "Invitar" (toggle): si el form está CERRADO lo abre; si está ABIERTO
   * envía (con la validación de correos existente).
   */
  protected onInviteButton(): void {
    if (!this.showInviteForm()) {
      this.showInviteForm.set(true);
      return;
    }
    this.invite();
  }
  /** "Cancelar": oculta el form y limpia lo tecleado. */
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
    // Validación de formato client-side: si algún correo está mal formado, NO
    // llamamos al backend (evita el 400) y avisamos exactamente cuáles fallan.
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
  // --- Salones (admin) ---
  protected readonly halls = signal<HallResponseDto[]>([]);
  protected readonly hallSearch = signal('');
  protected readonly hallDraft = signal<HallDraft | null>(null);
  protected readonly filteredHalls = computed(() => {
    const q = this.hallSearch().trim().toLowerCase();
    if (!q) return this.halls();
    return this.halls().filter(
      (h) => h.name.toLowerCase().includes(q) || (h.city ?? '').toLowerCase().includes(q),
    );
  });
  protected readonly hallsPage = signal(1);
  protected readonly hallsPageSize = 9;
  protected readonly hallsTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredHalls().length / 9)),
  );
  protected readonly pageHalls = computed(() => {
    const start = (this.hallsPage() - 1) * 9;
    return this.filteredHalls().slice(start, start + 9);
  });
  protected goToHallsPage(p: number): void {
    this.hallsPage.set(Math.min(Math.max(1, p), this.hallsTotalPages()));
  }
  protected setHallSearch(v: string): void {
    this.hallSearch.set(v);
    this.hallsPage.set(1);
  }
  private loadHalls(): void {
    this.hallsApi.list().subscribe({
      next: (h) => this.halls.set(h),
      error: () => this.toasts.error(this.translate.instant('config.halls.loadError')),
    });
  }
  protected newHall(): void {
    this.hallDraft.set({ id: null, name: '', address: '', city: '', notes: '', lat: null, lng: null });
  }
  protected editHall(h: HallResponseDto): void {
    this.hallDraft.set({
      id: h.id,
      name: h.name,
      address: h.address ?? '',
      city: h.city ?? '',
      notes: h.notes ?? '',
      lat: h.lat ?? null,
      lng: h.lng ?? null,
    });
  }
  protected cancelHallEdit(): void {
    this.hallDraft.set(null);
  }
  protected patchHall<K extends keyof HallDraft>(key: K, value: HallDraft[K]): void {
    const d = this.hallDraft();
    if (d) this.hallDraft.set({ ...d, [key]: value });
  }
  protected onHallMap(loc: MapLocation): void {
    const d = this.hallDraft();
    if (!d) return;
    this.hallDraft.set({ ...d, lat: loc.lat, lng: loc.lng, address: loc.address || d.address });
  }
  protected saveHall(): void {
    const d = this.hallDraft();
    if (!d || d.name.trim().length < 2) {
      this.toasts.warning(this.translate.instant('config.halls.nameRequired'));
      return;
    }
    const body = {
      name: d.name.trim(),
      address: d.address.trim() || undefined,
      city: d.city.trim() || undefined,
      notes: d.notes.trim() || undefined,
      lat: d.lat ?? undefined,
      lng: d.lng ?? undefined,
    };
    const req = d.id ? this.hallsApi.update(d.id, body) : this.hallsApi.create(body);
    req.subscribe({
      next: () => {
        this.toasts.success(this.translate.instant(d.id ? 'config.halls.updated' : 'config.halls.created'));
        this.hallDraft.set(null);
        this.loadHalls();
      },
      error: () => this.toasts.error(this.translate.instant('config.halls.saveError')),
    });
  }
  protected askRemoveHall(h: HallResponseDto): void {
    this.confirm.set({
      title: this.translate.instant('config.halls.removeConfirmTitle'),
      message: this.translate.instant('config.halls.removeConfirmMessage', { name: h.name }),
      confirmLabel: this.translate.instant('common.delete'),
      confirmIcon: 'delete',
      onConfirm: () =>
        this.hallsApi.remove(h.id).subscribe({
          next: () => {
            this.toasts.info(this.translate.instant('config.halls.removed'));
            this.loadHalls();
          },
          error: () => this.toasts.error(this.translate.instant('config.halls.removeError')),
        }),
    });
  }

  // --- Plantillas de asientos (admin) ---
  protected readonly templates = signal<SeatTemplateResponseDto[]>([]);
  protected readonly templateSearch = signal('');
  protected readonly templateDraft = signal<TemplateDraft | null>(null);
  protected readonly templateKinds = ['rows', 'theater', 'stadium', 'tables', 'grid', 'curve', 'line', 'custom'];
  protected readonly filteredTemplates = computed(() => {
    const q = this.templateSearch().trim().toLowerCase();
    if (!q) return this.templates();
    return this.templates().filter((t) => t.name.toLowerCase().includes(q));
  });
  private loadTemplates(): void {
    this.templatesApi.list().subscribe({
      next: (t) => this.templates.set(t),
      error: () => this.toasts.error(this.translate.instant('config.templates.loadError')),
    });
  }
  protected newTemplate(): void {
    this.templateDraft.set({ id: null, name: '', kind: 'grid', paramsJson: '{"rows":5,"cols":10}' });
  }
  protected editTemplate(t: SeatTemplateResponseDto): void {
    if (t.isBuiltIn) {
      this.toasts.warning(this.translate.instant('config.templates.builtInEditWarn'));
      return;
    }
    this.templateDraft.set({
      id: t.id,
      name: t.name,
      kind: t.kind,
      paramsJson: t.params ? JSON.stringify(t.params) : '',
    });
  }
  protected cancelTemplateEdit(): void {
    this.templateDraft.set(null);
  }
  protected patchTemplate<K extends keyof TemplateDraft>(key: K, value: TemplateDraft[K]): void {
    const d = this.templateDraft();
    if (d) this.templateDraft.set({ ...d, [key]: value });
  }
  protected saveTemplate(): void {
    const d = this.templateDraft();
    if (!d || d.name.trim().length < 2) {
      this.toasts.warning(this.translate.instant('config.templates.nameRequired'));
      return;
    }
    let params: Record<string, unknown> | undefined;
    if (d.paramsJson.trim()) {
      try {
        params = JSON.parse(d.paramsJson) as Record<string, unknown>;
      } catch {
        this.toasts.warning(this.translate.instant('config.templates.paramsJsonInvalid'));
        return;
      }
    }
    const body = { name: d.name.trim(), kind: d.kind as never, params };
    const req = d.id ? this.templatesApi.update(d.id, body) : this.templatesApi.create(body);
    req.subscribe({
      next: () => {
        this.toasts.success(this.translate.instant(d.id ? 'config.templates.updated' : 'config.templates.created'));
        this.templateDraft.set(null);
        this.loadTemplates();
      },
      error: (err: { status?: number }) =>
        this.toasts.error(
          this.translate.instant(
            err?.status === 409
              ? 'config.templates.builtInSaveError'
              : 'config.templates.saveError',
          ),
        ),
    });
  }
  protected askRemoveTemplate(t: SeatTemplateResponseDto): void {
    if (t.isBuiltIn) {
      this.toasts.warning(this.translate.instant('config.templates.builtInRemoveWarn'));
      return;
    }
    this.confirm.set({
      title: this.translate.instant('config.templates.removeConfirmTitle'),
      message: this.translate.instant('config.templates.removeConfirmMessage', { name: t.name }),
      confirmLabel: this.translate.instant('common.delete'),
      confirmIcon: 'delete',
      onConfirm: () =>
        this.templatesApi.remove(t.id).subscribe({
          next: () => {
            this.toasts.info(this.translate.instant('config.templates.removed'));
            this.loadTemplates();
          },
          error: () => this.toasts.error(this.translate.instant('config.templates.removeError')),
        }),
    });
  }

  // --- Configuraciones del sistema (catálogo) ---
  protected readonly settings = signal<SettingViewDto[]>([]);
  /** Valores en edición por clave (para no perder lo tecleado). */
  protected readonly settingEdits = signal<Record<string, number | boolean>>({});
  private loadSettings(): void {
    this.settingsApi.list().subscribe({
      next: (s) => {
        this.settings.set(s);
        this.settingEdits.set(Object.fromEntries(s.map((x) => [x.key, x.value])));
      },
      error: () => this.toasts.error(this.translate.instant('config.settings.loadError')),
    });
  }
  protected setSettingValue(key: string, value: number | boolean): void {
    this.settingEdits.update((e) => ({ ...e, [key]: value }));
  }
  protected saveSetting(s: SettingViewDto): void {
    const value = this.settingEdits()[s.key];
    this.settingsApi.update(s.key, value).subscribe({
      next: (updated) => {
        this.settings.update((list) => list.map((x) => (x.key === updated.key ? updated : x)));
        this.toasts.success(this.translate.instant('config.settings.saved', { key: s.key }));
      },
      error: () => this.toasts.error(this.translate.instant('config.settings.saveError')),
    });
  }

  // --- Confirmación de acciones destructivas ---
  protected readonly confirm = signal<ConfirmRequest | null>(null);
  protected onConfirmAccept(): void {
    const c = this.confirm();
    this.confirm.set(null);
    c?.onConfirm();
  }
  protected onConfirmCancel(): void {
    this.confirm.set(null);
  }

  protected askRevoke(i: InvitationListItemDto): void {
    this.confirm.set({
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
