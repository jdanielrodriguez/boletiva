import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { catchError, of } from 'rxjs';
import { EventsApi } from '../../core/api/events.api';
import type { PublicEventListDto } from '../../core/api/types';

/**
 * Landing pública. Prueba el circuito completo de F0: SSR + llamada al API vía
 * el SDK tipado. La petición GET se resuelve en el servidor (SSR espera a que
 * complete) y su resultado se transfiere al cliente (transfer-cache de
 * HttpClient) → sin doble fetch al hidratar.
 */
@Component({
  selector: 'app-home',
  imports: [DatePipe],
  templateUrl: './home.html',
})
export class Home {
  private readonly eventsApi = inject(EventsApi);

  private readonly data = toSignal(
    this.eventsApi.listPublic({ take: 20 }).pipe(catchError(() => of(null))),
    { initialValue: null as PublicEventListDto | null },
  );

  protected readonly events = computed(() => this.data()?.items ?? []);
  protected readonly total = computed(() => this.data()?.total ?? 0);
  protected readonly loaded = computed(() => this.data() !== null);
}
