import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CategoriesApi } from '../../core/api/categories.api';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { ToastService } from '../../core/ui/toast.service';
import { EventSettlementComponent } from '../../shared/event-settlement/event-settlement.component';
import { SeatEditorComponent } from './seat-editor.component';
import type {
  CategoryResponseDto,
  GatewayResponseDto,
  LocalityView,
  ManagedEventDetailDto,
} from '../../core/api/types';

type Tab = 'datos' | 'localidades' | 'banner' | 'config' | 'cuentas';
type BannerTemplate = 'aurora' | 'midnight' | 'sunset' | 'forest' | 'mono';

/** Convierte ISO a valor de <input datetime-local> (YYYY-MM-DDTHH:mm, hora local). */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Vista de edición de un evento (ruta aparte, F-v3). Secciones: datos, localidades
 * (con editor de asientos), banner con IA (plantilla + prompt + imágenes de
 * ejemplo), configuración (pasarela/IVA/cuotas) y cuentas del evento. Una vez
 * PUBLICADO, las localidades quedan bloqueadas y no se cambia pasarela/IVA (el
 * backend lo valida; aquí se refleja en la UI).
 */
@Component({
  selector: 'app-event-edit',
  imports: [FormsModule, RouterLink, EventSettlementComponent, SeatEditorComponent],
  templateUrl: './event-edit.page.html',
})
export class EventEditPage {
  private readonly api = inject(PromoterEventsApi);
  private readonly categoriesApi = inject(CategoriesApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);

  protected readonly templates: BannerTemplate[] = ['aurora', 'midnight', 'sunset', 'forest', 'mono'];

  protected readonly eventId = signal<string>(this.route.snapshot.paramMap.get('id') ?? '');
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

  // Datos
  protected readonly d = {
    name: signal(''),
    description: signal(''),
    categoryId: signal(''),
    address: signal(''),
    startsAt: signal(''),
    endsAt: signal(''),
  };
  // Config
  protected readonly c = {
    gatewayId: signal(''),
    ivaOnNet: signal(true),
    absorbInstallmentCost: signal(false),
  };

  // Localidades
  protected readonly localities = signal<LocalityView[]>([]);
  protected readonly editingSeatsFor = signal<string | null>(null);
  protected readonly locForm = {
    name: signal(''),
    kind: signal<'seated' | 'general'>('general'),
    capacity: signal<number | null>(null),
    desiredNet: signal<number | null>(null),
  };

  // Banner
  protected readonly banner = {
    template: signal<BannerTemplate>('aurora'),
    prompt: signal(''),
    sampleImages: signal(''),
  };
  protected readonly bannerUrl = signal<string | null>(null);
  protected readonly generatingBanner = signal(false);

  constructor() {
    this.categoriesApi.list().subscribe({ next: (c) => this.categories.set(c), error: () => undefined });
    this.api.activeGateways().subscribe({ next: (g) => this.gateways.set(g), error: () => undefined });
    this.reload();
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
    this.d.endsAt.set(toLocalInput(ev.endsAt));
    this.c.gatewayId.set(ev.gatewayId ?? '');
    this.c.ivaOnNet.set(ev.ivaOnNet);
    this.c.absorbInstallmentCost.set(ev.absorbInstallmentCost);
    this.bannerUrl.set(ev.media?.find((m) => m.kind === 'cover')?.url ?? null);
  }

  protected selectTab(t: Tab): void {
    this.tab.set(t);
  }

  // --- Datos ---
  protected saveData(): void {
    this.savingData.set(true);
    this.api
      .update(this.eventId(), {
        name: this.d.name(),
        description: this.d.description() || undefined,
        categoryId: this.d.categoryId() || undefined,
        address: this.d.address() || undefined,
        startsAt: this.d.startsAt() ? new Date(this.d.startsAt()).toISOString() : undefined,
        endsAt: this.d.endsAt() ? new Date(this.d.endsAt()).toISOString() : undefined,
        // Preserva la config actual (el contrato UpdateEventDto los exige).
        ivaOnNet: this.c.ivaOnNet(),
        absorbInstallmentCost: this.c.absorbInstallmentCost(),
      })
      .subscribe({
        next: (ev) => {
          this.savingData.set(false);
          this.event.set(ev);
          this.toasts.success('Datos del evento guardados.');
        },
        error: () => {
          this.savingData.set(false);
          this.toasts.error('No se pudieron guardar los datos (revisa las fechas).');
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

  /** El editor de asientos cambió el aforo → refresca la lista de localidades. */
  protected loadLocalitiesPublic(): void {
    this.loadLocalities();
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
          this.toasts.success('Localidad agregada.');
          this.loadLocalities();
        },
        error: () => this.toasts.error('No se pudo agregar la localidad (¿evento publicado?).'),
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

  protected toggleSeats(l: LocalityView): void {
    this.editingSeatsFor.set(this.editingSeatsFor() === l.id ? null : l.id);
  }

  // --- Banner ---
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
    this.api.publish(this.eventId()).subscribe({
      next: (ev) => {
        this.event.set(ev);
        this.toasts.success('Evento publicado.');
      },
      error: () => this.toasts.error('No se pudo publicar (¿faltan localidades?).'),
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

  protected remove(): void {
    this.api.remove(this.eventId()).subscribe({
      next: () => {
        this.toasts.success('Evento eliminado.');
        void this.router.navigateByUrl('/promotor');
      },
      error: () => this.toasts.error('Solo puedes eliminar eventos en borrador.'),
    });
  }
}
