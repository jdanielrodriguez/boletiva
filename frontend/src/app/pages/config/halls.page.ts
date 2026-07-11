import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { HallsApi } from '../../core/api/halls.api';
import { ToastService } from '../../core/ui/toast.service';
import {
  ConfirmDialogComponent,
  type ConfirmRequest,
} from '../../shared/confirm-dialog/confirm-dialog.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { MapPickerComponent, type MapLocation } from '../../shared/map/map-picker.component';
import { BackLinkComponent } from '../../shared/ui/back-link.component';
import { PagerComponent } from '../../shared/ui/pager.component';
import { StatusLabelPipe } from '../../shared/ui/status-label.pipe';
import type { HallResponseDto } from '../../core/api/types';

/** Borrador editable de un salón (crear/editar con ubicación en mapa). */
interface HallDraft {
  id: string | null;
  name: string;
  address: string;
  city: string;
  notes: string;
  lat: number | null;
  lng: number | null;
  status: string;
}

const PAGE = 9;

/**
 * Página dedicada de gestión de SALONES (v3.7, solo admin). Antes vivía como tab de
 * la consola; ahora es página aparte para crecer. Filtros por estado (todos/
 * publicado/borrador) + buscador + paginación. Estados draft/published con botones
 * Publicar/Despublicar. Guardar como borrador (default).
 */
@Component({
  selector: 'app-halls-page',
  imports: [
    FormsModule,
    TranslatePipe,
    StatusLabelPipe,
    IconComponent,
    ConfirmDialogComponent,
    MapPickerComponent,
    PagerComponent,
    BackLinkComponent,
  ],
  templateUrl: './halls.page.html',
})
export class HallsPage {
  private readonly hallsApi = inject(HallsApi);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected readonly halls = signal<HallResponseDto[]>([]);
  protected readonly search = signal('');
  protected readonly statusFilter = signal<string>('');
  protected readonly draft = signal<HallDraft | null>(null);
  protected readonly page = signal(1);

  /** Estados disponibles para el filtro (value interno → label capitalizado en UI). */
  protected readonly statusOptions = ['published', 'draft'];

  protected readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const st = this.statusFilter();
    return this.halls().filter((h) => {
      if (st && h.status !== st) return false;
      if (!q) return true;
      return h.name.toLowerCase().includes(q) || (h.city ?? '').toLowerCase().includes(q);
    });
  });
  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / PAGE)));
  protected readonly pageItems = computed(() => {
    const start = (this.page() - 1) * PAGE;
    return this.filtered().slice(start, start + PAGE);
  });

  constructor() {
    this.load();
  }

  private load(): void {
    this.hallsApi.listAll().subscribe({
      next: (h) => this.halls.set(h),
      error: () => this.toasts.error(this.translate.instant('config.halls.loadError')),
    });
  }

  protected goToPage(p: number): void {
    this.page.set(Math.min(Math.max(1, p), this.totalPages()));
  }
  protected setSearch(v: string): void {
    this.search.set(v);
    this.page.set(1);
  }
  protected setStatus(v: string): void {
    this.statusFilter.set(v);
    this.page.set(1);
  }

  protected newHall(): void {
    this.draft.set({ id: null, name: '', address: '', city: '', notes: '', lat: null, lng: null, status: 'draft' });
  }
  protected editHall(h: HallResponseDto): void {
    this.draft.set({
      id: h.id,
      name: h.name,
      address: h.address ?? '',
      city: h.city ?? '',
      notes: h.notes ?? '',
      lat: h.lat ?? null,
      lng: h.lng ?? null,
      status: h.status,
    });
  }
  protected cancelEdit(): void {
    this.draft.set(null);
  }
  protected patch<K extends keyof HallDraft>(key: K, value: HallDraft[K]): void {
    const d = this.draft();
    if (d) this.draft.set({ ...d, [key]: value });
  }
  protected onMap(loc: MapLocation): void {
    const d = this.draft();
    if (!d) return;
    this.draft.set({ ...d, lat: loc.lat, lng: loc.lng, address: loc.address || d.address });
  }
  /** Guarda el salón; `publish` fuerza estado publicado, si no conserva su estado (default draft). */
  protected save(publish = false): void {
    const d = this.draft();
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
      status: (publish ? 'published' : d.status) as 'draft' | 'published',
    };
    const req = d.id ? this.hallsApi.update(d.id, body) : this.hallsApi.create(body);
    req.subscribe({
      next: () => {
        this.toasts.success(this.translate.instant(d.id ? 'config.halls.updated' : 'config.halls.created'));
        this.draft.set(null);
        this.load();
      },
      error: () => this.toasts.error(this.translate.instant('config.halls.saveError')),
    });
  }

  protected publish(h: HallResponseDto): void {
    this.hallsApi.publish(h.id).subscribe({
      next: () => {
        this.toasts.success(this.translate.instant('config.halls.published'));
        this.load();
      },
      error: () => this.toasts.error(this.translate.instant('config.halls.publishError')),
    });
  }
  protected unpublish(h: HallResponseDto): void {
    this.hallsApi.unpublish(h.id).subscribe({
      next: () => {
        this.toasts.info(this.translate.instant('config.halls.unpublished'));
        this.load();
      },
      error: () => this.toasts.error(this.translate.instant('config.halls.publishError')),
    });
  }

  // --- Confirmación de borrado ---
  protected readonly confirm = signal<ConfirmRequest | null>(null);
  protected onConfirmAccept(): void {
    const c = this.confirm();
    this.confirm.set(null);
    c?.onConfirm();
  }
  protected onConfirmCancel(): void {
    this.confirm.set(null);
  }
  protected askRemove(h: HallResponseDto): void {
    this.confirm.set({
      title: this.translate.instant('config.halls.removeConfirmTitle'),
      message: this.translate.instant('config.halls.removeConfirmMessage', { name: h.name }),
      confirmLabel: this.translate.instant('common.delete'),
      confirmIcon: 'delete',
      onConfirm: () =>
        this.hallsApi.remove(h.id).subscribe({
          next: () => {
            this.toasts.info(this.translate.instant('config.halls.removed'));
            this.load();
          },
          error: () => this.toasts.error(this.translate.instant('config.halls.removeError')),
        }),
    });
  }
}
