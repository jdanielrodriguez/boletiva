import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, afterNextRender, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { switchMap, tap } from 'rxjs';
import { EventsApi } from '../../core/api/events.api';
import { SessionStore } from '../../core/auth/session.store';
import { SITE_URL } from '../../core/config/api.tokens';
import type { LocalityAvailabilityDto } from '../../core/api/types';
import { LoginModal } from '../../shared/login-modal/login-modal.component';
import { ShareBox } from '../../shared/share-box/share-box.component';
import { ReservationItems } from '../../shared/reservation-items/reservation-items.component';
import { SeatMapComponent } from './seat-map.component';
import { PurchaseService } from './purchase.service';

type Phase = 'select' | 'reserved' | 'expired';

/**
 * Compra (F2). Selección ABIERTA (sin login): el cuadro de total + "Reservar"
 * van ARRIBA, siempre visibles junto al mapa/selectores. Al reservar se crea una
 * reserva ANÓNIMA compartible (link + redes). El login se pide en MODAL solo al
 * "Continuar al pago", sin salir de la página ni perder la reserva.
 */
@Component({
  selector: 'app-purchase',
  imports: [SeatMapComponent, DecimalPipe, ShareBox, LoginModal, ReservationItems],
  templateUrl: './purchase.page.html',
  providers: [PurchaseService],
})
export class PurchasePage implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly eventsApi = inject(EventsApi);
  private readonly session = inject(SessionStore);
  private readonly siteUrl = inject(SITE_URL);
  protected readonly store = inject(PurchaseService);

  protected readonly phase = signal<Phase>('select');
  protected readonly secondsLeft = signal(0);
  protected readonly working = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showLogin = signal(false);
  protected readonly eventName = signal('');
  protected readonly loaded = signal(false);

  private ticker: ReturnType<typeof setInterval> | null = null;

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
        if (!this.store.activeLocalityId() && av.localities.length > 0) {
          // La localidad viene del botón del detalle (?loc=); si no, la primera.
          const wanted = this.route.snapshot.queryParamMap.get('loc');
          const chosen = av.localities.find((l) => l.id === wanted) ?? av.localities[0];
          this.store.setActiveLocality(chosen.id);
        }
        this.loaded.set(true);
      }),
    ),
    { initialValue: null },
  );

  protected readonly shareUrl = computed(
    () => `${this.siteUrl}/reserva/${this.store.reservation()?.token ?? ''}`,
  );
  protected readonly mm = computed(() => Math.floor(this.secondsLeft() / 60));
  protected readonly ss = computed(() => this.secondsLeft() % 60);

  constructor() {
    afterNextRender(() => {
      this.ticker = setInterval(() => this.tick(), 1000);
    });
  }

  protected onQuantity(loc: LocalityAvailabilityDto, value: string): void {
    const n = Math.max(0, Math.min(this.store.maxFor(loc), Number(value) || 0));
    this.store.setQuantity(loc.id, n);
  }

  protected range(loc: LocalityAvailabilityDto): number[] {
    return Array.from({ length: this.store.maxFor(loc) + 1 }, (_, i) => i);
  }

  /** Reservar NO exige login: crea la reserva anónima compartible. */
  protected reserve(): void {
    if (this.store.totalCount() === 0) return;
    this.working.set(true);
    this.error.set(null);
    this.store.reserve().subscribe({
      next: (res) => {
        this.working.set(false);
        this.phase.set('reserved');
        this.secondsLeft.set(this.remaining(res.expiresAt ?? null));
        this.store.clearSelection();
      },
      error: () => {
        this.working.set(false);
        this.error.set('No se pudieron reservar los boletos (alguien más los tomó). Intenta de nuevo.');
      },
    });
  }

  /** Continuar al pago: el login se pide AQUÍ (modal), no antes. */
  protected continueToPay(): void {
    this.session.ensureLoaded().subscribe((user) => {
      if (!user || !this.session.isEmailVerified()) {
        this.showLogin.set(true);
        return;
      }
      this.doCheckout();
    });
  }

  protected onLoggedIn(): void {
    this.showLogin.set(false);
    this.doCheckout();
  }

  private doCheckout(): void {
    this.working.set(true);
    this.store.checkout().subscribe({
      next: (order) => void this.router.navigate(['/checkout', order.id]),
      error: () => {
        this.working.set(false);
        this.error.set('No se pudo continuar al pago. Intenta de nuevo.');
      },
    });
  }

  protected backToSelect(): void {
    this.phase.set('select');
    this.store.reservation.set(null);
  }

  private remaining(expiresAt: string | null): number {
    if (!expiresAt) return 0;
    return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
  }

  private tick(): void {
    if (this.phase() !== 'reserved') return;
    const left = this.remaining(this.store.reservation()?.expiresAt ?? null);
    this.secondsLeft.set(left);
    if (left === 0) this.phase.set('expired');
  }

  ngOnDestroy(): void {
    if (this.ticker) clearInterval(this.ticker);
  }
}
