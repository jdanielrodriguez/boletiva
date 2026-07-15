import { Component, RESPONSE_INIT, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { catchError, map, of, startWith, switchMap, tap } from 'rxjs';
import { EventsApi } from '../../core/api/events.api';
import type {
  EventAvailabilityDto,
  LocalityAvailabilityDto,
  PublicEventDetailDto,
} from '../../core/api/types';
import { LocalizedDatePipe } from '../../core/i18n/localized-date.pipe';
import { BackLinkComponent } from '../../shared/ui/back-link.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { LoadingComponent } from '../../shared/ui/loading.component';
import { SeoService } from '../../core/seo/seo.service';

interface DetailData {
  ev: PublicEventDetailDto;
  av: EventAvailabilityDto;
}

const EMPTY_AV: EventAvailabilityDto = { seatMap: null, localities: [], seats: [] };

/**
 * Detalle público de un evento por slug. SSR + SEO (Open Graph + JSON-LD Event).
 * Muestra las localidades como FILAS con imagen, info y precio por boleto
 * (server-authoritative, vía el endpoint de disponibilidad). La compra es en /comprar.
 */
@Component({
  selector: 'app-event-detail',
  imports: [
    RouterLink,
    LocalizedDatePipe,
    TranslatePipe,
    BackLinkComponent,
    EmptyStateComponent,
    LoadingComponent,
  ],
  templateUrl: './event-detail.html',
})
export class EventDetail {
  private readonly route = inject(ActivatedRoute);
  private readonly eventsApi = inject(EventsApi);
  private readonly seo = inject(SeoService);
  private readonly responseInit = inject(RESPONSE_INIT, { optional: true });

  private readonly data = toSignal(
    this.route.paramMap.pipe(
      switchMap((pm) => {
        const slug = pm.get('slug') ?? '';
        return this.eventsApi.getBySlug(slug).pipe(
          tap((ev) => this.applySeo(ev)),
          switchMap((ev) =>
            this.eventsApi.availability(ev.id).pipe(
              catchError(() => of(EMPTY_AV)),
              map((av): DetailData => ({ ev, av })),
            ),
          ),
          catchError(() => {
            this.applyNotFound(slug);
            return of(null);
          }),
        );
      }),
      startWith(undefined),
    ),
    { initialValue: undefined as DetailData | null | undefined },
  );

  protected readonly event = computed(() => this.data()?.ev ?? null);
  /** Ventas abiertas solo si el evento aún no inició (coherente con el backend). */
  protected readonly salesOpen = computed(() => {
    const ev = this.event();
    return !ev || new Date(ev.startsAt).getTime() > Date.now();
  });
  protected readonly localities = computed<LocalityAvailabilityDto[]>(
    () => this.data()?.av.localities ?? [],
  );
  protected readonly loading = computed(() => this.data() === undefined);
  protected readonly notFound = computed(() => this.data() === null);
  protected readonly coverImage = computed(() => {
    const ev = this.event();
    return ev ? this.mediaUrl(ev) : undefined;
  });

  private mediaUrl(ev: PublicEventDetailDto): string | undefined {
    const cover = ev.media.find((m) => m.kind === 'cover') ?? ev.media[0];
    return cover?.url;
  }

  private applySeo(ev: PublicEventDetailDto): void {
    const description = ev.description?.slice(0, 300) ?? `Boletos para ${ev.name} en Boletiva.`;
    this.seo.apply({
      title: `${ev.name} — Boletiva`,
      description,
      path: `/eventos/${ev.slug}`,
      type: 'event',
      image: this.mediaUrl(ev),
      jsonLd: this.buildJsonLd(ev),
    });
  }

  private applyNotFound(slug: string): void {
    if (this.responseInit) this.responseInit.status = 404;
    this.seo.apply({
      title: 'Evento no encontrado — Boletiva',
      description: 'El evento que buscas no existe o ya no está disponible.',
      path: `/eventos/${slug}`,
      noindex: true,
    });
  }

  private buildJsonLd(ev: PublicEventDetailDto): Record<string, unknown> {
    const statusMap: Record<string, string> = {
      published: 'https://schema.org/EventScheduled',
      cancelled: 'https://schema.org/EventCancelled',
      finished: 'https://schema.org/EventScheduled',
      draft: 'https://schema.org/EventScheduled',
    };
    const location = ev.address
      ? {
          '@type': 'Place',
          name: ev.address,
          ...(ev.lat != null && ev.lng != null
            ? { geo: { '@type': 'GeoCoordinates', latitude: ev.lat, longitude: ev.lng } }
            : {}),
        }
      : undefined;
    return {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: ev.name,
      startDate: ev.startsAt,
      endDate: ev.endsAt,
      eventStatus: statusMap[ev.status] ?? 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      ...(ev.description ? { description: ev.description } : {}),
      ...(location ? { location } : {}),
    };
  }
}
