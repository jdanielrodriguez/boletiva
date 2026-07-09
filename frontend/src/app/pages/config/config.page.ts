import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AdminApi,
  AdminEventListItemDto,
  GatewayResponseDto,
  PromoterListItemDto,
} from '../../core/api/admin.api';
import { SessionStore } from '../../core/auth/session.store';
import { ToastService } from '../../core/ui/toast.service';
import { PromoterPanel } from '../promoter/promoter-panel';

type AdminTab = 'eventos' | 'promotores' | 'sistema';

/** Grupo de eventos por fecha (para la vista admin agrupada por día). */
interface EventDateGroup {
  date: string;
  events: AdminEventListItemDto[];
}

/**
 * Configuración (F7): separada del Perfil. Solo promotor/admin (roleGuard).
 * - Promotor → gestiona SUS eventos (reutiliza el panel del promotor).
 * - Admin → todos los eventos agrupados por fecha + gestión de promotores +
 *   configuración del sistema (cost-share, "activar pruebas", pasarelas).
 */
@Component({
  selector: 'app-config-page',
  imports: [FormsModule, DatePipe, PromoterPanel],
  templateUrl: './config.page.html',
})
export class ConfigPage {
  protected readonly session = inject(SessionStore);
  private readonly admin = inject(AdminApi);
  private readonly toasts = inject(ToastService);

  protected readonly isAdmin = computed(() => this.session.hasAnyRole(['admin']));
  protected readonly tab = signal<AdminTab>('eventos');

  // Eventos (admin)
  protected readonly events = signal<AdminEventListItemDto[]>([]);
  protected readonly eventsByDate = computed<EventDateGroup[]>(() => {
    const groups = new Map<string, AdminEventListItemDto[]>();
    for (const e of this.events()) {
      const date = (e.startsAt ?? '').slice(0, 10) || 'Sin fecha';
      const arr = groups.get(date) ?? [];
      arr.push(e);
      groups.set(date, arr);
    }
    return [...groups.entries()].map(([date, events]) => ({ date, events }));
  });

  // Promotores (admin)
  protected readonly promoters = signal<PromoterListItemDto[]>([]);
  protected readonly promoterFilter = signal<string>('');

  // Sistema (admin)
  protected readonly requireApproval = signal<boolean | null>(null);
  protected readonly defaultPct = signal<number | null>(null);
  protected readonly gateways = signal<GatewayResponseDto[]>([]);

  constructor() {
    if (this.isAdmin()) this.loadEvents();
  }

  protected selectTab(t: AdminTab): void {
    this.tab.set(t);
    if (t === 'eventos' && this.events().length === 0) this.loadEvents();
    if (t === 'promotores' && this.promoters().length === 0) this.loadPromoters();
    if (t === 'sistema' && this.requireApproval() === null) this.loadSystem();
  }

  // --- Eventos ---
  private loadEvents(): void {
    this.admin.listAllEvents().subscribe({
      next: (e) => this.events.set(e),
      error: () => this.toasts.error('No se pudieron cargar los eventos.'),
    });
  }

  // --- Promotores ---
  protected loadPromoters(): void {
    this.admin.listPromoters(this.promoterFilter() || undefined).subscribe({
      next: (p) => this.promoters.set(p),
      error: () => this.toasts.error('No se pudieron cargar los promotores.'),
    });
  }

  protected approve(id: string): void {
    this.admin.approvePromoter(id).subscribe({
      next: () => {
        this.toasts.success('Promotor aprobado.');
        this.loadPromoters();
      },
      error: () => this.toasts.error('No se pudo aprobar.'),
    });
  }

  protected reject(id: string): void {
    this.admin.rejectPromoter(id).subscribe({
      next: () => {
        this.toasts.info('Solicitud rechazada.');
        this.loadPromoters();
      },
      error: () => this.toasts.error('No se pudo rechazar.'),
    });
  }

  protected suspend(id: string): void {
    this.admin.suspendPromoter(id).subscribe({
      next: () => {
        this.toasts.info('Promotor suspendido.');
        this.loadPromoters();
      },
      error: () => this.toasts.error('No se pudo suspender.'),
    });
  }

  protected setPromoterPct(id: string, value: string): void {
    const pct = Number(value);
    if (Number.isNaN(pct) || pct < 0 || pct > 1) {
      this.toasts.warning('El reparto debe estar entre 0 y 1 (p.ej. 0.5 = 50%).');
      return;
    }
    this.admin.setPromoterPct(id, pct).subscribe({
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
}
