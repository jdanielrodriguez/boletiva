import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, afterNextRender, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { switchMap, tap } from 'rxjs';
import { EventsApi } from '../../core/api/events.api';
import { SessionStore } from '../../core/auth/session.store';
import type { LocalityAvailabilityDto } from '../../core/api/types';
import { SeatMapComponent } from './seat-map.component';
import { PurchaseService } from './purchase.service';

type Phase = 'select' | 'reserved' | 'expired';

/**
 * Pantalla de compra (F2). Carga la disponibilidad del evento y ofrece:
 * - Localidades CON asientos → mapa Konva.
 * - Localidades SIN mapa (default) → selector por cantidad (tope = boletos
 *   permitidos por localidad = min(disponibles, 50)).
 * Reserva (hold) con countdown local del TTL de Redis; luego crea la orden y
 * pasa al checkout. Libera el hold al salir o al expirar.
 */
@Component({
  selector: 'app-purchase',
  imports: [SeatMapComponent, DecimalPipe],
  templateUrl: './purchase.page.html',
  providers: [PurchaseService],
})
export class PurchasePage implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly eventsApi = inject(EventsApi);
  private readonly session = inject(SessionStore);
  protected readonly store = inject(PurchaseService);

  protected readonly phase = signal<Phase>('select');
  protected readonly secondsLeft = signal(0);
  protected readonly working = signal(false);
  protected readonly error = signal<string | null>(null);

  private ticker: ReturnType<typeof setInterval> | null = null;

  protected readonly eventName = signal('');
  protected readonly loaded = signal(false);

  // Carga: slug → detalle (id + nombre) → disponibilidad.
  private readonly data = toSignal(
    this.route.paramMap.pipe(
      switchMap((pm) => this.eventsApi.getBySlug(pm.get('slug') ?? '')),
      tap((ev) => {
        this.eventName.set(ev.name);
        this.store.eventId.set(ev.id);
      }),
      switchMap((ev) => this.eventsApi.availability(ev.id)),
      tap((av) => {
        this.store.availability.set(av);
        this.loaded.set(true);
      }),
    ),
    { initialValue: null },
  );

  protected readonly seatLocalities = computed(() => {
    const av = this.data();
    if (!av) return [];
    const withSeats = new Set(av.seats.map((s) => s.localityId));
    return av.localities.filter((l) => withSeats.has(l.id));
  });

  protected readonly mm = computed(() => Math.floor(this.secondsLeft() / 60));
  protected readonly ss = computed(() => this.secondsLeft() % 60);

  constructor() {
    afterNextRender(() => {
      this.ticker = setInterval(() => this.tick(), 1000);
    });
  }

  protected seatsForLocality(localityId: string) {
    return (this.data()?.seats ?? []).filter((s) => s.localityId === localityId);
  }

  protected onQuantity(loc: LocalityAvailabilityDto, value: string): void {
    const n = Math.max(0, Math.min(this.store.maxFor(loc), Number(value) || 0));
    this.store.setQuantity(loc.id, n);
  }

  protected range(loc: LocalityAvailabilityDto): number[] {
    return Array.from({ length: this.store.maxFor(loc) + 1 }, (_, i) => i);
  }

  protected reserve(): void {
    if (this.store.totalCount() === 0) return;
    this.working.set(true);
    this.error.set(null);
    // El login se exige AQUÍ (al reservar = paso hacia el pago), no al buscar.
    // Resuelve la sesión (por si aún no hidrató) y decide.
    this.session.ensureLoaded().subscribe((user) => {
      if (!user) {
        this.working.set(false);
        void this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
        return;
      }
      if (!this.session.isEmailVerified()) {
        this.working.set(false);
        void this.router.navigate(['/verificar-correo']);
        return;
      }
      this.doHold();
    });
  }

  private doHold(): void {
    this.store.hold().subscribe({
      next: () => {
        this.working.set(false);
        this.phase.set('reserved');
        this.tick();
      },
      error: () => {
        this.working.set(false);
        this.error.set('No se pudieron reservar los boletos (alguien más los tomó). Intenta de nuevo.');
      },
    });
  }

  protected pay(): void {
    this.working.set(true);
    this.store.createOrder().subscribe({
      next: (order) => void this.router.navigate(['/checkout', order.id]),
      error: () => {
        this.working.set(false);
        this.error.set('No se pudo crear la orden. Intenta de nuevo.');
      },
    });
  }

  protected cancel(): void {
    this.store.release();
    this.phase.set('select');
  }

  private tick(): void {
    const exp = this.store.expiresAt();
    if (exp === null || this.phase() !== 'reserved') return;
    const left = Math.max(0, Math.round((exp - Date.now()) / 1000));
    this.secondsLeft.set(left);
    if (left === 0) {
      this.store.release();
      this.phase.set('expired');
    }
  }

  ngOnDestroy(): void {
    if (this.ticker) clearInterval(this.ticker);
    if (this.phase() === 'reserved') this.store.release();
  }
}
