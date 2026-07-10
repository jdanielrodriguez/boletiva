import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { switchMap } from 'rxjs';
import { PromotersApi } from '../../core/api/promoters.api';
import { AuthRefreshService } from '../../core/auth/auth-refresh.service';
import { SessionStore } from '../../core/auth/session.store';
import { ToastService } from '../../core/ui/toast.service';

/** Vista según el estado de la solicitud del usuario. */
type View = 'loading' | 'form' | 'pending' | 'approved';

/**
 * "Conviértete en promotor" (v3.6): formulario de solicitud de autorización para
 * clientes. Llama `POST /promoters/apply`.
 *  - En "modo pruebas" (`promoters.require_approval=false`) la solicitud se
 *    auto-aprueba → refrescamos token (JWT con el rol nuevo) + sesión (/auth/me
 *    lee los roles de la BD) para que la UI muestre ya el rol promotor, y
 *    redirigimos a su panel.
 *  - Si requiere aprobación del admin → estado "pendiente".
 * Si el usuario ya es promotor/admin o ya tiene una solicitud aprobada, no se
 * muestra el formulario (se le lleva a su panel / se informa el estado).
 */
@Component({
  selector: 'app-become-promoter',
  imports: [FormsModule, RouterLink, TranslatePipe],
  template: `
    <div class="auth-wrap">
      <section class="auth-card">
        <h1>{{ 'becomePromoter.title' | translate }}</h1>

        @switch (view()) {
          @case ('loading') {
            <p class="auth-sub">{{ 'common.loading' | translate }}</p>
          }
          @case ('approved') {
            <p class="auth-sub" data-testid="bp-approved">
              {{ 'becomePromoter.alreadyPromoter' | translate }}
            </p>
            <a class="primary btn-block" routerLink="/promotor">{{
              'becomePromoter.goToPanel' | translate
            }}</a>
          }
          @case ('pending') {
            <p class="auth-sub" data-testid="bp-pending">
              {{ 'becomePromoter.pending' | translate }}
            </p>
            <a class="primary btn-block" routerLink="/cuenta">{{
              'becomePromoter.backToAccount' | translate
            }}</a>
          }
          @case ('form') {
            <p class="auth-sub">{{ 'becomePromoter.intro' | translate }}</p>

            <ul class="bp-benefits">
              <li>{{ 'becomePromoter.benefit1' | translate }}</li>
              <li>{{ 'becomePromoter.benefit2' | translate }}</li>
              <li>{{ 'becomePromoter.benefit3' | translate }}</li>
            </ul>

            @if (error()) {
              <p class="form-error" data-testid="bp-error">{{ error() }}</p>
            }

            <form (ngSubmit)="submit()">
              <div class="field">
                <label for="motive">{{ 'becomePromoter.motiveLabel' | translate }}</label>
                <textarea
                  id="motive"
                  name="motive"
                  rows="4"
                  maxlength="500"
                  [attr.placeholder]="'becomePromoter.motivePlaceholder' | translate"
                  [ngModel]="motive()"
                  (ngModelChange)="motive.set($event)"
                ></textarea>
                <small class="muted">{{ 'becomePromoter.motiveHint' | translate }}</small>
              </div>

              <button
                type="submit"
                class="primary btn-block"
                data-testid="bp-submit"
                [disabled]="working()"
              >
                {{
                  working()
                    ? ('becomePromoter.sending' | translate)
                    : ('becomePromoter.submit' | translate)
                }}
              </button>
            </form>
          }
        }
      </section>
    </div>
  `,
})
export class BecomePromoterPage {
  private readonly promoters = inject(PromotersApi);
  private readonly session = inject(SessionStore);
  private readonly refresher = inject(AuthRefreshService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected readonly view = signal<View>('loading');
  protected readonly motive = signal('');
  protected readonly working = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    // Ya es promotor/admin → no tiene sentido solicitar; a su panel.
    if (this.session.hasAnyRole(['promoter', 'admin'])) {
      void this.router.navigate(['/promotor']);
      return;
    }
    this.promoters.myStatus().subscribe({
      next: (s) => {
        if (s.promoterStatus === 'approved') this.view.set('approved');
        else if (s.promoterStatus === 'pending') this.view.set('pending');
        else this.view.set('form');
      },
      // Sin estado disponible: mostramos el formulario igualmente.
      error: () => this.view.set('form'),
    });
  }

  protected submit(): void {
    if (this.working()) return;
    this.working.set(true);
    this.error.set(null);
    this.promoters.apply().subscribe({
      next: (res) => {
        if (res.promoterStatus === 'approved') {
          this.onApproved();
        } else {
          this.working.set(false);
          this.view.set('pending');
          this.toasts.success(this.translate.instant('becomePromoter.msgSubmitted'));
        }
      },
      error: () => {
        this.working.set(false);
        this.error.set(this.translate.instant('becomePromoter.msgError'));
      },
    });
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
