import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { HallsApi } from '../../core/api/halls.api';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { MapPickerComponent, type MapLocation } from '../../shared/map/map-picker.component';
import { BackLinkComponent } from '../../shared/ui/back-link.component';
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

/**
 * Página de alta/edición de un SALÓN (v3.8 · G2). MISMA página en dos modos:
 * `nuevo` (formulario en blanco) y edición (con id en la ruta → carga el salón).
 * Antes la creación/edición vivía embebida en la lista; ahora es página aparte
 * (como el editor de eventos). Guardar como borrador (default) o Guardar+publicar;
 * al guardar con éxito vuelve a la lista.
 */
@Component({
  selector: 'app-hall-edit-page',
  imports: [FormsModule, TranslatePipe, IconComponent, MapPickerComponent, BackLinkComponent],
  templateUrl: './hall-edit.page.html',
})
export class HallEditPage {
  private readonly hallsApi = inject(HallsApi);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly hallId = this.route.snapshot.paramMap.get('id');
  protected readonly isNew = this.hallId == null;

  protected readonly draft = signal<HallDraft | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadError = signal(false);
  protected readonly saving = signal(false);

  protected readonly heading = computed(() =>
    this.isNew ? 'config.halls.newPageTitle' : 'config.halls.editPageTitle',
  );

  constructor() {
    if (this.hallId) {
      this.loadHall(this.hallId);
    } else {
      this.draft.set({ id: null, name: '', address: '', city: '', notes: '', lat: null, lng: null, status: 'draft' });
    }
  }

  private loadHall(id: string): void {
    this.loading.set(true);
    this.loadError.set(false);
    this.hallsApi.get(id).subscribe({
      next: (h: HallResponseDto) => {
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
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set(true);
        this.toasts.error(this.translate.instant('config.halls.loadError'));
      },
    });
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
    this.saving.set(true);
    const req = d.id ? this.hallsApi.update(d.id, body) : this.hallsApi.create(body);
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.toasts.success(this.translate.instant(d.id ? 'config.halls.updated' : 'config.halls.created'));
        void this.router.navigate(['/configuracion'], { queryParams: { tab: 'salones' } });
      },
      error: () => {
        this.saving.set(false);
        this.toasts.error(this.translate.instant('config.halls.saveError'));
      },
    });
  }

  protected cancel(): void {
    void this.router.navigate(['/configuracion'], { queryParams: { tab: 'salones' } });
  }
}
