import { DecimalPipe, isPlatformBrowser } from '@angular/common';
import { Component, OnDestroy, PLATFORM_ID, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, of, switchMap, tap } from 'rxjs';
import { Subscription } from 'rxjs';
import { EventsApi } from '../../core/api/events.api';
import { ReservationsApi } from '../../core/api/reservations.api';
import { SeatStreamService } from '../../core/api/seat-stream.service';
import { apiErrorMessage } from '../../core/http/api-error';
import { ToastService } from '../../core/ui/toast.service';
import { RecaptchaService } from '../../core/security/recaptcha.service';
import { SessionStore } from '../../core/auth/session.store';
import { SITE_URL } from '../../core/config/api.tokens';
import type { LocalityAvailabilityDto } from '../../core/api/types';
import { ConfirmController } from '../../shared/confirm-dialog/confirm-controller';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { LoginModal } from '../../shared/login-modal/login-modal.component';
import { ShareBox } from '../../shared/share-box/share-box.component';
import { ReservationItems } from '../../shared/reservation-items/reservation-items.component';
import { MoneyPipe } from '../../shared/money.pipe';
import { LoadingComponent } from '../../shared/ui/loading.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { TourComponent, TourStep } from '../../shared/tour/tour.component';
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
    MoneyPipe,
    ShareBox,
    LoginModal,
    ReservationItems,
    LoadingComponent,
    EmptyStateComponent,
    TranslatePipe,
    IconComponent,
    ConfirmDialogComponent,
    TourComponent,
  ],
  templateUrl: './purchase.page.html',
  providers: [PurchaseService],
})
export class PurchasePage implements OnDestroy {
  /** Tour de compra (logueados una vez; anónimos con activación aleatoria). */
  protected readonly tourSteps: TourStep[] = [
    { title: 'tour.purchase.welcomeTitle', body: 'tour.purchase.welcomeBody' },
    { title: 'tour.purchase.reserveTitle', body: 'tour.purchase.reserveBody' },
    { title: 'tour.purchase.payTitle', body: 'tour.purchase.payBody' },
  ];
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly eventsApi = inject(EventsApi);
  private readonly session = inject(SessionStore);
  private readonly siteUrl = inject(SITE_URL);
  private readonly translate = inject(TranslateService);
  private readonly toasts = inject(ToastService);
  protected readonly store = inject(PurchaseService);
  private readonly recaptcha = inject(RecaptchaService);
  private readonly reservationsApi = inject(ReservationsApi);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly seatStream = inject(SeatStreamService);
  private seatSub?: Subscription;
  protected readonly confirm = new ConfirmController();

  /** Evita rehidratar la reserva más de una vez por visita. */
  private restored = false;

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
  /**
   * Segundos restantes de cooldown (0 = sin cronómetro). Es AUTORITATIVO: se
   * siembra desde el TTL de Redis (endpoint /reservations/cooldown), por lo que
   * al recargar la página muestra el tiempo real, no uno reiniciado.
   */
  /** Duración del zoom cinematográfico de la cámara del mapa (ms). Configurable a futuro
   *  desde la config del admin (via /public/config); por ahora un default agradable. */
  protected readonly cameraMs = signal(900);
  protected readonly cooldownSeconds = signal(0);
  protected readonly cooldownMm = computed(() => Math.floor(this.cooldownSeconds() / 60));
  protected readonly cooldownSs = computed(() => this.cooldownSeconds() % 60);
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
        // Disponibilidad en vivo (FU11): repinta el mapa cuando otros compran/liberan.
        if (isPlatformBrowser(this.platformId) && !this.seatSub) {
          this.seatSub = this.seatStream.stream(ev.id).subscribe((delta) => this.store.applySeatDelta(delta));
        }
      }),
      switchMap((ev) => this.eventsApi.availability(ev.id)),
      tap((av) => {
        this.store.availability.set(av);
        if (!this.store.activeLocalityId() && av.localities.length > 0) {
          // La localidad puede venir del botón del detalle (?loc=). Si NO viene:
          // - con mapa (asientos numerados) → NO se auto-selecciona → vista LEJANA de
          //   todo el recinto (el comprador elige su zona en el mapa o en los chips).
          // - solo-general (sin mapa) → se activa la primera para mostrar el stepper.
          const wanted = this.route.snapshot.queryParamMap.get('loc');
          const chosen = wanted ? av.localities.find((l) => l.id === wanted) : undefined;
          if (chosen) this.store.setActiveLocality(chosen.id);
          else if (!this.store.hasSeatedMap()) this.store.setActiveLocality(av.localities[0].id);
        }
        this.loaded.set(true);
        this.tryRestore(); // reanuda una reserva viva tras un F5
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
    // Al activar una zona GENERAL, el mapa se deshabilita y el foco va al stepper de
    // cantidad (que está ARRIBA del mapa) → el comprador ve dónde elegir la cantidad.
    effect(() => {
      if (this.store.activeIsGeneral() && isPlatformBrowser(this.platformId)) {
        setTimeout(() => {
          (document.querySelector('[data-testid="qty-plus"]') as HTMLElement | null)?.focus();
        }, 0);
      }
    });
    afterNextRender(() => {
      this.ticker = setInterval(() => this.tick(), 1000);
      // Al cargar (o recargar) la página, si el visitante sigue en cooldown, el
      // banner + cronómetro reaparecen con el tiempo REAL restante (TTL en Redis).
      this.refreshCooldown();
    });
  }

  /**
   * Consulta el estado de cooldown del visitante y, si aplica, muestra el banner
   * con el cronómetro sembrado desde el tiempo autoritativo del backend.
   */
  private refreshCooldown(): void {
    this.reservationsApi.cooldown().subscribe({
      next: (s) => {
        if (s.onCooldown && s.retryAfterSeconds > 0) {
          this.cooldownSeconds.set(s.retryAfterSeconds);
          this.blocked.set(this.translate.instant('purchase.reserveCooldown'));
        }
      },
      error: () => undefined, // best-effort: no rompe la vista si falla
    });
  }

  /** Cierra el banner de bloqueo (X). Reaparece si se intenta reservar de nuevo. */
  protected dismissBlocked(): void {
    this.blocked.set(null);
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
    // reCAPTCHA (config-gated: sin site key devuelve '' → el backend omite la verificación).
    this.recaptcha.execute('reservation').then((captchaToken) => this.store.reserve(captchaToken).subscribe({
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
          // Trae el tiempo restante REAL (TTL en Redis) para el cronómetro; si es
          // por "reserva activa" (no cooldown) no hay cronómetro (retryAfter=0).
          this.refreshCooldown();
        } else {
          // Mostrar la causa REAL del backend (p.ej. "Captcha inválido") y hacerla
          // VISIBLE con un toast de error, no solo el texto inline genérico.
          const msg = apiErrorMessage(err, this.translate.instant('purchase.reserveError'));
          this.error.set(msg);
          this.toasts.error(msg);
        }
      },
    }));
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

  /**
   * El NIT/nombre de facturación se captura en el CHECKOUT (no en la reserva).
   */
  private doCheckout(): void {
    this.working.set(true);
    this.store
      .checkout()
      .subscribe({
      next: (order) => void this.router.navigate(['/checkout', order.id]),
      error: (err: { status?: number; error?: { message?: string } }) => {
        this.working.set(false);
        const msg = apiErrorMessage(err, this.translate.instant('purchase.checkoutError'));
        this.error.set(msg);
        this.toasts.error(msg);
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

  /**
   * Tras un F5 la reserva se pierde de memoria pero sigue viva en el backend. Aquí
   * la revalidamos por su token (persistido en localStorage) y, si aún vive,
   * restauramos la fase "reservado" con su countdown. Solo en navegador y una vez.
   */
  private tryRestore(): void {
    if (this.restored || !isPlatformBrowser(this.platformId)) return;
    this.restored = true;
    if (this.store.reservation()) return; // ya hay una en memoria (misma visita)
    this.store.restore().subscribe((res) => {
      if (!res) return;
      this.phase.set('reserved');
      this.secondsLeft.set(this.remaining(res.expiresAt ?? null));
    });
  }

  private remaining(expiresAt: string | null): number {
    if (!expiresAt) return 0;
    return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
  }

  private tick(): void {
    // Cronómetro de cooldown (independiente de la fase): al llegar a 0, el banner
    // desaparece porque ya se puede reservar de nuevo.
    if (this.cooldownSeconds() > 0) {
      const next = this.cooldownSeconds() - 1;
      this.cooldownSeconds.set(next);
      if (next === 0 && this.blocked()) this.blocked.set(null);
    }
    if (this.phase() !== 'reserved') return;
    const left = this.remaining(this.store.reservation()?.expiresAt ?? null);
    this.secondsLeft.set(left);
    if (left === 0) {
      this.phase.set('expired');
      this.store.clearPersisted(); // ya no hay nada que reanudar
    }
  }

  ngOnDestroy(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.seatSub?.unsubscribe();
  }
}
