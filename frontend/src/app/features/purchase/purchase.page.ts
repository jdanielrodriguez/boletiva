import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, afterNextRender, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, of, switchMap, tap } from 'rxjs';
import { EventsApi } from '../../core/api/events.api';
import { SessionStore } from '../../core/auth/session.store';
import { SITE_URL } from '../../core/config/api.tokens';
import type { LocalityAvailabilityDto } from '../../core/api/types';
import { ConfirmController } from '../../shared/confirm-dialog/confirm-controller';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { LoginModal } from '../../shared/login-modal/login-modal.component';
import { ShareBox } from '../../shared/share-box/share-box.component';
import { ReservationItems } from '../../shared/reservation-items/reservation-items.component';
import { LoadingComponent } from '../../shared/ui/loading.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
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
  imports: [
    SeatMapComponent,
    DecimalPipe,
    ShareBox,
    LoginModal,
    ReservationItems,
    LoadingComponent,
    EmptyStateComponent,
    TranslatePipe,
    IconComponent,
    ConfirmDialogComponent,
  ],
  templateUrl: './purchase.page.html',
  providers: [PurchaseService],
})
export class PurchasePage implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly eventsApi = inject(EventsApi);
  private readonly session = inject(SessionStore);
  private readonly siteUrl = inject(SITE_URL);
  private readonly translate = inject(TranslateService);
  protected readonly store = inject(PurchaseService);
  protected readonly confirm = new ConfirmController();

  protected readonly phase = signal<Phase>('select');
  protected readonly secondsLeft = signal(0);
  protected readonly working = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showLogin = signal(false);
  /**
   * Advertencia anti-abuso: un VISITANTE solo puede tener 1 reserva anónima activa
   * (o está en cooldown tras cancelar). El backend responde 429; mostramos el porqué
   * y ofrecemos iniciar sesión (con sesión NO hay límite → puede reservar de una).
   */
  protected readonly blocked = signal<string | null>(null);
  /** Para qué se pidió el login: reintentar la reserva o continuar al pago. */
  private loginIntent: 'reserve' | 'pay' = 'pay';
  protected readonly eventName = signal('');
  protected readonly loaded = signal(false);
  /** Falló la carga de la disponibilidad/mapa → vista de error (C2). */
  protected readonly loadError = signal(false);

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
      catchError(() => {
        // No rompemos el stream: marcamos error y la vista muestra el estado.
        this.loadError.set(true);
        this.loaded.set(true);
        return of(null);
      }),
    ),
    { initialValue: null },
  );

  /** No hay localidades disponibles para comprar (evento sin inventario). */
  protected readonly noLocalities = computed(
    () => this.loaded() && !this.loadError() && this.store.localities().length === 0,
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

  /** Stepper +/− de cantidad para una localidad general (capado a [0, max]). */
  protected changeQuantity(loc: LocalityAvailabilityDto, delta: number): void {
    const current = this.store.quantityFor(loc.id);
    const n = Math.max(0, Math.min(this.store.maxFor(loc), current + delta));
    this.store.setQuantity(loc.id, n);
  }

  /** Confirmación de la selección antes de reservar (pide OK con el resumen). */
  protected reserve(): void {
    if (this.store.totalCount() === 0 || this.working()) return;
    this.confirm.ask({
      title: this.translate.instant('purchase.confirmReserveTitle'),
      message: this.translate.instant('purchase.confirmReserveMessage', {
        n: this.store.totalCount(),
        total: this.store.totalDisplay(),
      }),
      confirmLabel: this.translate.instant('purchase.reserve'),
      confirmIcon: 'activate',
      titleIcon: 'seats',
      onConfirm: () => this.doReserve(),
    });
  }

  /** Reservar NO exige login: crea la reserva anónima compartible. */
  private doReserve(): void {
    if (this.store.totalCount() === 0) return;
    this.working.set(true);
    this.error.set(null);
    this.blocked.set(null);
    this.store.reserve().subscribe({
      next: (res) => {
        this.working.set(false);
        this.phase.set('reserved');
        this.secondsLeft.set(this.remaining(res.expiresAt ?? null));
        this.store.clearSelection();
      },
      error: (err: { status?: number; error?: { message?: string } }) => {
        this.working.set(false);
        // 429 = límite anti-abuso de reservas anónimas: NO es un error de sistema.
        // Conservamos la selección para poder reintentar tras iniciar sesión.
        if (err?.status === 429) {
          this.blocked.set(err?.error?.message ?? this.translate.instant('purchase.reserveLimit'));
        } else {
          this.error.set(this.translate.instant('purchase.reserveError'));
        }
      },
    });
  }

  /** Desde la advertencia 429: iniciar sesión para reservar de inmediato. */
  protected loginToReserve(): void {
    this.loginIntent = 'reserve';
    this.showLogin.set(true);
  }

  /** Continuar al pago: el login se pide AQUÍ (modal), no antes. */
  protected continueToPay(): void {
    this.session.ensureLoaded().subscribe((user) => {
      if (!user || !this.session.isEmailVerified()) {
        this.loginIntent = 'pay';
        this.showLogin.set(true);
        return;
      }
      this.doCheckout();
    });
  }

  protected onLoggedIn(): void {
    this.showLogin.set(false);
    // Con sesión ya no hay límite por IP: retomamos lo que el usuario quería.
    if (this.loginIntent === 'reserve') {
      this.blocked.set(null);
      this.doReserve();
    } else {
      this.doCheckout();
    }
  }

  private doCheckout(): void {
    this.working.set(true);
    this.store.checkout().subscribe({
      next: (order) => void this.router.navigate(['/checkout', order.id]),
      error: () => {
        this.working.set(false);
        this.error.set(this.translate.instant('purchase.checkoutError'));
      },
    });
  }

  protected backToSelect(): void {
    // Cancelar de verdad: libera los cupos en el backend e inicia el cooldown
    // (anti-abuso). Fire-and-forget; el estado local se limpia de una.
    this.store.cancel().subscribe({ error: () => undefined });
    this.phase.set('select');
    this.error.set(null);
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
