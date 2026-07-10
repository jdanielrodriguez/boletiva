import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  AdminApi,
  AdminEventListItemDto,
  GatewayResponseDto,
  PromoterListItemDto,
  PromoterStatusEventDto,
} from '../../core/api/admin.api';
import { InvitationsApi } from '../../core/api/invitations.api';
import { ToastService } from '../../core/ui/toast.service';
import {
  ConfirmDialogComponent,
  type ConfirmRequest,
} from '../../shared/confirm-dialog/confirm-dialog.component';
import { IconComponent } from '../../shared/icon/icon.component';
import type { CreatedInvitationDto, InvitationListItemDto } from '../../core/api/types';

type AdminTab = 'eventos' | 'promotores' | 'sistema' | 'invitaciones';

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
  imports: [FormsModule, DatePipe, IconComponent, ConfirmDialogComponent],
  templateUrl: './config.page.html',
})
export class ConfigPage {
  private readonly admin = inject(AdminApi);
  private readonly invitationsApi = inject(InvitationsApi);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly tab = signal<AdminTab>('eventos');

  // --- Eventos ---
  protected readonly events = signal<AdminEventListItemDto[]>([]);
  protected readonly eventsPage = signal(1);
  protected readonly eventsPageSize = EVENTS_PAGE;
  protected readonly eventSearch = signal('');
  protected readonly eventStatus = signal('');
  protected readonly filteredEvents = computed(() => {
    const q = this.eventSearch().trim().toLowerCase();
    const status = this.eventStatus();
    return this.events().filter((e) => {
      if (status && e.status !== status) return false;
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
    this.loadEvents();
  }

  protected selectTab(t: AdminTab): void {
    this.tab.set(t);
    if (t === 'eventos' && this.events().length === 0) this.loadEvents();
    if (t === 'promotores' && this.promoters().length === 0) this.loadPromoters();
    if (t === 'sistema' && this.requireApproval() === null) this.loadSystem();
    if (t === 'invitaciones' && this.invitations().length === 0) this.loadInvitations();
  }

  // --- Eventos ---
  private loadEvents(): void {
    this.admin.listAllEvents().subscribe({
      next: (e) => {
        this.events.set(e);
        this.eventsPage.set(1);
      },
      error: () => this.toasts.error('No se pudieron cargar los eventos.'),
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

  // --- Promotores ---
  protected loadPromoters(): void {
    this.admin.listPromoters(this.promoterStatus() || undefined).subscribe({
      next: (p) => this.promoters.set(p),
      error: () => this.toasts.error('No se pudieron cargar los promotores.'),
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
        this.toasts.success(`${p.firstName} aprobado como promotor.`);
        this.loadPromoters();
      },
      error: () => this.toasts.error('No se pudo aprobar.'),
    });
  }
  protected reject(p: PromoterListItemDto): void {
    this.admin.rejectPromoter(p.id, this.noteFor(p.id)).subscribe({
      next: () => {
        this.toasts.info(`Solicitud de ${p.firstName} rechazada.`);
        this.loadPromoters();
      },
      error: () => this.toasts.error('No se pudo rechazar.'),
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
        this.toasts.info(`${p.firstName} suspendido.`);
        this.suspendTarget.set(null);
        this.loadPromoters();
      },
      error: () => this.toasts.error('No se pudo suspender.'),
    });
  }

  // --- Historial de estados (append-only) ---
  protected readonly historyFor = signal<string | null>(null);
  protected readonly history = signal<PromoterStatusEventDto[]>([]);
  protected toggleHistory(p: PromoterListItemDto): void {
    if (this.historyFor() === p.id) {
      this.historyFor.set(null);
      return;
    }
    this.historyFor.set(p.id);
    this.history.set([]);
    this.admin.promoterHistory(p.id).subscribe({
      next: (h) => this.history.set(h),
      error: () => this.toasts.error('No se pudo cargar el historial.'),
    });
  }
  protected setPromoterPct(p: PromoterListItemDto, value: string): void {
    const pct = Number(value);
    if (Number.isNaN(pct) || pct < 0 || pct > 1) {
      this.toasts.warning('El reparto debe estar entre 0 y 1 (p.ej. 0.5 = 50%).');
      return;
    }
    this.admin.setPromoterPct(p.id, pct).subscribe({
      next: () => this.toasts.success('Reparto del promotor actualizado.'),
      error: () => this.toasts.error('No se pudo actualizar el reparto.'),
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
        this.toasts.success(next ? 'Autorización de promotores exigida.' : 'Modo pruebas: auto-aprobación activada.');
      },
      error: () => this.toasts.error('No se pudo cambiar la configuración.'),
    });
  }
  protected saveDefaultPct(value: string): void {
    const pct = Number(value);
    if (Number.isNaN(pct) || pct < 0 || pct > 1) {
      this.toasts.warning('El reparto por defecto debe estar entre 0 y 1.');
      return;
    }
    this.admin.setDefaultPct(pct).subscribe({
      next: () => {
        this.defaultPct.set(pct);
        this.toasts.success('Reparto por defecto actualizado.');
      },
      error: () => this.toasts.error('No se pudo actualizar el reparto por defecto.'),
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
        this.toasts.warning('Las tasas de cuotas deben ser JSON válido (p.ej. {"3":0.08}).');
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
          this.toasts.success('Pasarela actualizada.');
          this.gatewayDraft.set(null);
          this.loadGateways();
        },
        error: () => this.toasts.error('No se pudo actualizar la pasarela.'),
      });
  }
  protected setGatewayStatus(g: GatewayResponseDto, status: string): void {
    this.admin.setGatewayStatus(g.id, status).subscribe({
      next: () => {
        this.toasts.success('Estado de la pasarela actualizado.');
        this.loadGateways();
      },
      error: () => this.toasts.error('No se pudo cambiar el estado (¿es la default?).'),
    });
  }
  protected makeDefault(g: GatewayResponseDto): void {
    this.admin.makeGatewayDefault(g.id).subscribe({
      next: () => {
        this.toasts.success(`"${g.name}" es la nueva pasarela default.`);
        this.loadGateways();
      },
      error: () => this.toasts.error('No se pudo definir como default.'),
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
        this.toasts.info('Te enviamos un código al correo para autorizar agregar la pasarela.');
      },
      error: () => this.toasts.error('No se pudo enviar el código de desbloqueo.'),
    });
  }
  /** Confirma el código (habilita el formulario de creación). */
  protected confirmUnlock(): void {
    if (this.unlockCode().trim().length < 6) {
      this.toasts.warning('Ingresa el código de 6 dígitos que recibiste.');
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
      this.toasts.warning('La pasarela necesita un nombre.');
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
          this.toasts.success(`Pasarela "${g.name}" agregada.`);
          this.cancelUnlock();
          this.newGateway.set({ name: '', provider: 'pagalo', feePct: 0.03, transactionFixedFee: 0 });
          this.loadGateways();
        },
        error: () => this.toasts.error('No se pudo agregar (¿código inválido o expirado?).'),
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
  protected invite(): void {
    const emails = this.parsedEmails();
    if (emails.length === 0) {
      this.toasts.warning('Ingresa al menos un correo.');
      return;
    }
    this.inviting.set(true);
    this.invitationsApi.create(emails, this.inviteTestUser()).subscribe({
      next: (res) => {
        this.inviting.set(false);
        this.created.set(res.invitations);
        this.emailsText.set('');
        this.inviteTestUser.set(false);
        this.toasts.success(`Se generaron ${res.invitations.length} invitación(es).`);
        this.loadInvitations();
      },
      error: () => {
        this.inviting.set(false);
        this.toasts.error('No se pudieron crear las invitaciones (revisa los correos).');
      },
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
      title: 'Revocar invitación',
      message: `¿Seguro que deseas revocar la invitación de ${i.email}? El enlace dejará de funcionar.`,
      confirmLabel: 'Revocar',
      confirmIcon: 'revoke',
      onConfirm: () => this.revoke(i),
    });
  }

  protected revoke(i: InvitationListItemDto): void {
    this.invitationsApi.revoke(i.id).subscribe({
      next: () => {
        this.toasts.info('Invitación revocada.');
        this.loadInvitations();
      },
      error: () => this.toasts.error('No se pudo revocar la invitación.'),
    });
  }
}
