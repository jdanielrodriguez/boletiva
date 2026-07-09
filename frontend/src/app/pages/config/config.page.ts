import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  AdminApi,
  AdminEventListItemDto,
  GatewayResponseDto,
  PromoterListItemDto,
} from '../../core/api/admin.api';
import { InvitationsApi } from '../../core/api/invitations.api';
import { ToastService } from '../../core/ui/toast.service';
import { EventSettlementComponent } from '../../shared/event-settlement/event-settlement.component';
import type { CreatedInvitationDto, InvitationListItemDto } from '../../core/api/types';

type AdminTab = 'eventos' | 'promotores' | 'sistema' | 'invitaciones';

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

/**
 * Consola de administración (F-v3, SOLO admin — roleGuard admin). Tabs: Eventos
 * (todos, grid + cuentas por evento), Promotores (búsqueda/filtro + edición
 * contextual con nota y cost-share), Sistema (pasarelas editables + default +
 * cost-share default + modo pruebas) e Invitaciones (invitar promotores, exclusivo
 * admin). El panel del promotor vive en /promotor (separado de verdad).
 */
@Component({
  selector: 'app-config-page',
  imports: [FormsModule, DatePipe, RouterLink, EventSettlementComponent],
  templateUrl: './config.page.html',
})
export class ConfigPage {
  private readonly admin = inject(AdminApi);
  private readonly invitationsApi = inject(InvitationsApi);
  private readonly toasts = inject(ToastService);

  protected readonly tab = signal<AdminTab>('eventos');

  // --- Eventos ---
  protected readonly events = signal<AdminEventListItemDto[]>([]);
  protected readonly eventsPage = signal(1);
  protected readonly eventsPageSize = EVENTS_PAGE;
  protected readonly selectedEvent = signal<string | null>(null);
  protected readonly eventsTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.events().length / EVENTS_PAGE)),
  );
  protected readonly pageEvents = computed(() => {
    const start = (this.eventsPage() - 1) * EVENTS_PAGE;
    return this.events().slice(start, start + EVENTS_PAGE);
  });

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

  // --- Invitaciones ---
  protected readonly emailsText = signal('');
  protected readonly created = signal<CreatedInvitationDto[]>([]);
  protected readonly invitations = signal<InvitationListItemDto[]>([]);
  protected readonly inviting = signal(false);

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
  protected toggleEvent(id: string): void {
    this.selectedEvent.set(this.selectedEvent() === id ? null : id);
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
  protected suspend(p: PromoterListItemDto): void {
    this.admin.suspendPromoter(p.id, this.noteFor(p.id)).subscribe({
      next: () => {
        this.toasts.info(`${p.firstName} suspendido.`);
        this.loadPromoters();
      },
      error: () => this.toasts.error('No se pudo suspender.'),
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
    this.invitationsApi.create(emails).subscribe({
      next: (res) => {
        this.inviting.set(false);
        this.created.set(res.invitations);
        this.emailsText.set('');
        this.toasts.success(`Se generaron ${res.invitations.length} invitación(es).`);
        this.loadInvitations();
      },
      error: () => {
        this.inviting.set(false);
        this.toasts.error('No se pudieron crear las invitaciones (revisa los correos).');
      },
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
