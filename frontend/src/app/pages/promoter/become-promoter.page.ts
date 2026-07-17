import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { from, switchMap } from 'rxjs';
import { PromotersApi, type PromoterStatusResponseDto, type PromoterTier } from '../../core/api/promoters.api';
import { AuthRefreshService } from '../../core/auth/auth-refresh.service';
import { SessionStore } from '../../core/auth/session.store';
import { TokenStore } from '../../core/auth/token-store.service';
import { RecaptchaService } from '../../core/security/recaptcha.service';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent } from '../../shared/icon/icon.component';

/** Vista según el estado de la solicitud del usuario. */
type View = 'loading' | 'plans' | 'pending' | 'approved';

/** Definición estática de un plan (para el grid de precios). */
interface Plan {
  tier: PromoterTier;
  nameKey: string;
  taglineKey: string;
  priceKey: string;
  featureKeys: string[];
  recommended: boolean;
  comingSoon: boolean;
}

const PLANS: Plan[] = [
  {
    tier: 'free',
    nameKey: 'becomePromoter.planFreeName',
    taglineKey: 'becomePromoter.planFreeTagline',
    priceKey: 'becomePromoter.planFreePrice',
    featureKeys: [
      'becomePromoter.planFreeF1',
      'becomePromoter.planFreeF2',
      'becomePromoter.planFreeF3',
      'becomePromoter.planFreeF4',
    ],
    recommended: false,
    comingSoon: false,
  },
  {
    tier: 'premium',
    nameKey: 'becomePromoter.planPremiumName',
    taglineKey: 'becomePromoter.planPremiumTagline',
    priceKey: 'becomePromoter.planPremiumPrice',
    featureKeys: [
      'becomePromoter.planPremiumF1',
      'becomePromoter.planPremiumF2',
      'becomePromoter.planPremiumF3',
      'becomePromoter.planPremiumF4',
      'becomePromoter.planPremiumF5',
    ],
    recommended: true,
    comingSoon: true,
  },
];

/**
 * "Conviértete en promotor" (rediseñada como PANTALLA DE PLANES free/premium):
 *  - El grid de planes se muestra SIEMPRE (también a visitantes sin sesión, para
 *    poder promocionar el alta desde la landing / botón del header).
 *  - Elegir un plan estando logueado → modal de instrucciones → `POST /promoters/apply`
 *    con el `tier`. En "modo pruebas" auto-aprueba (refresca token + sesión → panel);
 *    si requiere aprobación → modal "proceso iniciado" y queda pendiente.
 *  - Elegir un plan SIN sesión → formulario de registro en un paso
 *    (`POST /promoters/register`): crea la cuenta, adopta la sesión y aplica el alta.
 * El captcha es config-gated (token '' cuando no hay site key → no bloquea dev/test).
 * La aplicación de features por plan (premium real) es un follow-up.
 */
@Component({
  selector: 'app-become-promoter',
  imports: [FormsModule, RouterLink, TranslatePipe, IconComponent],
  templateUrl: './become-promoter.page.html',
  styleUrl: './become-promoter.page.css',
})
export class BecomePromoterPage {
  private readonly promoters = inject(PromotersApi);
  private readonly session = inject(SessionStore);
  private readonly tokens = inject(TokenStore);
  private readonly refresher = inject(AuthRefreshService);
  private readonly recaptcha = inject(RecaptchaService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected readonly plans = PLANS;
  protected readonly view = signal<View>('loading');
  protected readonly working = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly selectedTier = signal<PromoterTier>('free');
  /** ¿Hay sesión activa? (define si al elegir plan pedimos registro o aplicamos). */
  protected readonly loggedIn = signal(false);

  /** Modales: instrucciones / proceso iniciado / registro de visitante. */
  protected readonly showInfo = signal(false);
  protected readonly showStarted = signal(false);
  protected readonly showRegister = signal(false);

  // Formulario de registro (visitante).
  protected readonly regFirstName = signal('');
  protected readonly regEmail = signal('');
  protected readonly regPassword = signal('');

  constructor() {
    // Ya es promotor/admin → no tiene sentido solicitar; a su panel.
    if (this.session.hasAnyRole(['promoter', 'admin'])) {
      void this.router.navigate(['/promotor']);
      return;
    }
    if (!this.session.isAuthenticated()) {
      // Visitante: mostramos los planes; al elegir pediremos registro.
      this.loggedIn.set(false);
      this.view.set('plans');
      return;
    }
    this.loggedIn.set(true);
    this.promoters.myStatus().subscribe({
      next: (s) => {
        if (s.promoterStatus === 'approved') this.view.set('approved');
        else if (s.promoterStatus === 'pending') this.view.set('pending');
        else this.view.set('plans');
      },
      // Sin estado disponible: mostramos los planes igualmente.
      error: () => this.view.set('plans'),
    });
  }

  /** Elegir un plan: con sesión abre instrucciones; sin sesión abre el registro. */
  protected choosePlan(tier: PromoterTier): void {
    this.error.set(null);
    this.selectedTier.set(tier);
    if (this.loggedIn()) this.showInfo.set(true);
    else this.showRegister.set(true);
  }

  /** Confirmación (usuario logueado) → envía la solicitud con el plan elegido. */
  protected confirmApply(): void {
    if (this.working()) return;
    this.working.set(true);
    this.error.set(null);
    from(this.recaptcha.execute('promoter_apply'))
      .pipe(switchMap((token) => this.promoters.apply(this.selectedTier(), token || undefined)))
      .subscribe({
        next: (res) => this.onApplied(res, () => this.showInfo.set(false)),
        error: () => {
          this.working.set(false);
          this.showInfo.set(false);
          this.error.set(this.translate.instant('becomePromoter.msgError'));
        },
      });
  }

  /** Envío del formulario de registro (visitante) → crea cuenta + aplica el alta. */
  protected submitRegister(): void {
    if (this.working()) return;
    if (!this.regFirstName() || !this.regEmail() || this.regPassword().length < 8) {
      this.error.set(this.translate.instant('becomePromoter.regCompleteFields'));
      return;
    }
    this.working.set(true);
    this.error.set(null);
    from(this.recaptcha.execute('promoter_register'))
      .pipe(
        switchMap((token) =>
          this.promoters.register(
            {
              email: this.regEmail(),
              password: this.regPassword(),
              firstName: this.regFirstName(),
              tier: this.selectedTier(),
            },
            token || undefined,
          ),
        ),
      )
      .subscribe({
        next: (res) => {
          // Adopta la sesión recién creada (access en memoria + /auth/me lo recarga).
          this.tokens.setAccessToken(res.tokens.accessToken);
          this.session.setUser(res.user);
          this.loggedIn.set(true);
          this.onApplied(res.promoter, () => this.showRegister.set(false));
        },
        error: () => {
          this.working.set(false);
          this.error.set(this.translate.instant('becomePromoter.regError'));
        },
      });
  }

  /** Maneja el resultado de aplicar (approved → panel; pending → modal iniciada). */
  private onApplied(res: PromoterStatusResponseDto, closeModal: () => void): void {
    closeModal();
    if (res.promoterStatus === 'approved') {
      this.onApproved();
    } else {
      this.working.set(false);
      this.view.set('pending');
      this.showStarted.set(true);
    }
  }

  /** Cierra la 2ª modal (proceso iniciado). */
  protected closeStarted(): void {
    this.showStarted.set(false);
    this.toasts.success(this.translate.instant('becomePromoter.msgSubmitted'));
  }

  /**
   * Auto-aprobado (modo pruebas): refresca el token (para que el JWT lleve el rol
   * `promoter` y pueda operar) y luego recarga /auth/me (los roles vienen de la
   * BD) → la UI muestra ya el rol nuevo. Redirige al panel del promotor.
   */
  private onApproved(): void {
    this.refresher
      .refresh()
      .pipe(switchMap(() => this.session.loadMe()))
      .subscribe({
        next: () => this.finishApproved(),
        // Aunque falle el refresh, recargamos la sesión para reflejar el rol.
        error: () => this.session.loadMe().subscribe({ next: () => this.finishApproved() }),
      });
  }

  private finishApproved(): void {
    this.working.set(false);
    this.toasts.success(this.translate.instant('becomePromoter.msgApproved'));
    void this.router.navigate(['/promotor']);
  }
}
