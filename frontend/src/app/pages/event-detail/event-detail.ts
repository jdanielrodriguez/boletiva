import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, of, startWith, switchMap, tap } from 'rxjs';
import { EventsApi } from '../../core/api/events.api';
import type { PublicEventDetailDto } from '../../core/api/types';
import { SeoService } from '../../core/seo/seo.service';

/**
 * Detalle público de un evento por slug. SSR + SEO enriquecido (Open Graph +
 * JSON-LD schema.org/Event para rich results). La compra (mapa de asientos,
 * holds, pago) llega en F2; aquí solo mostramos la ficha y las localidades.
 */
@Component({
  selector: 'app-event-detail',
  imports: [RouterLink, DatePipe],
  templateUrl: './event-detail.html',
})
export class EventDetail {
  private readonly route = inject(ActivatedRoute);
  private readonly eventsApi = inject(EventsApi);
  private readonly seo = inject(SeoService);

  // undefined = cargando · null = no encontrado · objeto = cargado
  private readonly data = toSignal(
    this.route.paramMap.pipe(
      switchMap((pm) => {
        const slug = pm.get('slug') ?? '';
        return this.eventsApi.getBySlug(slug).pipe(
          tap((ev) => this.applySeo(ev)),
          catchError(() => {
            this.applyNotFound(slug);
            return of(null);
          }),
        );
      }),
      startWith(undefined),
    ),
    { initialValue: undefined as PublicEventDetailDto | null | undefined },
  );

  protected readonly event = computed(() => this.data() ?? null);
  protected readonly loading = computed(() => this.data() === undefined);
  protected readonly notFound = computed(() => this.data() === null);

  private applySeo(ev: PublicEventDetailDto): void {
    const description =
      ev.description?.slice(0, 300) ?? `Boletos para ${ev.name} en Pasa Eventos.`;
    this.seo.apply({
      title: `${ev.name} — Pasa Eventos`,
      description,
      path: `/eventos/${ev.slug}`,
      type: 'event',
      jsonLd: this.buildJsonLd(ev),
    });
  }

  private applyNotFound(slug: string): void {
    this.seo.apply({
      title: 'Evento no encontrado — Pasa Eventos',
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
