import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, afterNextRender, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, of, startWith, switchMap } from 'rxjs';
import { ReservationsApi } from '../../core/api/reservations.api';
import { SessionStore } from '../../core/auth/session.store';
import type { ReservationResponseDto } from '../../core/api/types';
import { LocalizedDatePipe } from '../../core/i18n/localized-date.pipe';
import { LoginModal } from '../../shared/login-modal/login-modal.component';
import { ReservationItems } from '../../shared/reservation-items/reservation-items.component';
import { MoneyPipe } from '../../shared/money.pipe';

/**
 * Vista de una reserva compartida (`/reserva/:token`) — lo que abre la persona
 * que va a pagar (p.ej. el padre). Muestra los boletos + total + tiempo restante
 * y permite pagar iniciando sesión en un modal.
 */
@Component({
  selector: 'app-reservation',
  imports: [DecimalPipe, LocalizedDatePipe, TranslatePipe, RouterLink, LoginModal, ReservationItems, MoneyPipe],
  templateUrl: './reservation.page.html',
})
export class ReservationPage implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ReservationsApi);
  private readonly session = inject(SessionStore);
  private readonly translate = inject(TranslateService);

  protected readonly working = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showLogin = signal(false);
  protected readonly secondsLeft = signal(0);
  private ticker: ReturnType<typeof setInterval> | null = null;
  private token = '';

  private readonly data = toSignal(
    this.route.paramMap.pipe(
      switchMap((pm) => {
        this.token = pm.get('token') ?? '';
        return this.api.getByToken(this.token).pipe(catchError(() => of(null)));
      }),
      startWith(undefined),
    ),
    { initialValue: undefined as ReservationResponseDto | null | undefined },
  );

  protected readonly reservation = computed(() => this.data() ?? null);
  protected readonly loading = computed(() => this.data() === undefined);
  protected readonly notFound = computed(() => this.data() === null);
  protected readonly mm = computed(() => Math.floor(this.secondsLeft() / 60));
  protected readonly ss = computed(() => this.secondsLeft() % 60);

  constructor() {
    afterNextRender(() => {
      this.ticker = setInterval(() => this.tick(), 1000);
    });
  }

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
    this.api.checkout(this.token).subscribe({
      next: (order) => void this.router.navigate(['/checkout', order.id]),
      error: () => {
        this.working.set(false);
        this.error.set(this.translate.instant('reservation.msgPayFailed'));
      },
    });
  }

  private tick(): void {
    const exp = this.reservation()?.expiresAt;
    if (!exp) return;
    this.secondsLeft.set(Math.max(0, Math.round((new Date(exp).getTime() - Date.now()) / 1000)));
  }

  ngOnDestroy(): void {
    if (this.ticker) clearInterval(this.ticker);
  }
}
