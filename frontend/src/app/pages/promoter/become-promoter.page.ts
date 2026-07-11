import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { switchMap } from 'rxjs';
import { PromotersApi } from '../../core/api/promoters.api';
import { AuthRefreshService } from '../../core/auth/auth-refresh.service';
import { SessionStore } from '../../core/auth/session.store';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent } from '../../shared/icon/icon.component';

/** Vista según el estado de la solicitud del usuario. */
type View = 'loading' | 'form' | 'pending' | 'approved';

/**
 * "Conviértete en promotor" (v3.6 · rediseñada en v3.8/G3): el envío ya NO es
 * one-click. Al pulsar "Quiero ser promotor" se abre una MODAL de instrucciones
 * que explica qué es un promotor y qué puede hacer; el usuario decide ahí. Al
 * confirmar se llama `POST /promoters/apply`:
 *  - En "modo pruebas" (`promoters.require_approval=false`) la solicitud se
 *    auto-aprueba → refrescamos token (JWT con el rol nuevo) + sesión (/auth/me)
 *    y redirigimos a su panel.
 *  - Si requiere aprobación del admin → mostramos una 2ª modal ("iniciaste tu
 *    proceso, pronto te contactarán") y el estado queda "pendiente".
 * Si el usuario ya es promotor/admin o ya tiene una solicitud aprobada, no se
 * muestra el formulario (se le lleva a su panel / se informa el estado).
 */
@Component({
  selector: 'app-become-promoter',
  imports: [FormsModule, RouterLink, TranslatePipe, IconComponent],
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
            <a class="btn primary btn-block" routerLink="/promotor">{{
              'becomePromoter.goToPanel' | translate
            }}</a>
          }
          @case ('pending') {
            <p class="auth-sub" data-testid="bp-pending">
              {{ 'becomePromoter.pending' | translate }}
            </p>
            <a class="btn primary btn-block" routerLink="/cuenta">{{
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
              type="button"
              class="btn primary btn-block"
              data-testid="bp-submit"
              [disabled]="working()"
              (click)="openInfo()"
            >
              {{ 'becomePromoter.startApplication' | translate }}
            </button>
          }
        }
      </section>
    </div>

    <!-- 1ª MODAL: qué es un promotor y qué puede hacer -->
    @if (showInfo()) {
      <div class="modal-backdrop" data-testid="bp-info-modal">
        <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="bp-info-title">
          <div class="bp-modal-head">
            <span class="bp-modal-icon" aria-hidden="true"><app-icon name="help" [size]="28" /></span>
            <h2 id="bp-info-title">{{ 'becomePromoter.infoTitle' | translate }}</h2>
          </div>
          <p class="bp-modal-lead">{{ 'becomePromoter.infoLead' | translate }}</p>
          <ul class="bp-benefits">
            <li>{{ 'becomePromoter.infoCan1' | translate }}</li>
            <li>{{ 'becomePromoter.infoCan2' | translate }}</li>
            <li>{{ 'becomePromoter.infoCan3' | translate }}</li>
            <li>{{ 'becomePromoter.infoCan4' | translate }}</li>
          </ul>
          <p class="bp-modal-ask">{{ 'becomePromoter.infoAsk' | translate }}</p>
          <div class="ev-card-actions confirm-actions">
            <button
              type="button"
              class="btn primary"
              data-testid="bp-info-confirm"
              [disabled]="working()"
              (click)="confirmApply()"
            >
              {{ working() ? ('becomePromoter.sending' | translate) : ('becomePromoter.infoYes' | translate) }}
            </button>
            <button type="button" class="btn" data-testid="bp-info-cancel" [disabled]="working()" (click)="showInfo.set(false)">
              {{ 'becomePromoter.infoNo' | translate }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- 2ª MODAL: proceso iniciado (solo cuando requiere aprobación del admin) -->
    @if (showStarted()) {
      <div class="modal-backdrop" data-testid="bp-started-modal">
        <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="bp-started-title">
          <div class="bp-modal-head">
            <span class="bp-modal-icon ok" aria-hidden="true"><app-icon name="activate" [size]="28" /></span>
            <h2 id="bp-started-title">{{ 'becomePromoter.startedTitle' | translate }}</h2>
          </div>
          <p class="bp-modal-lead">{{ 'becomePromoter.startedBody' | translate }}</p>
          <div class="ev-card-actions confirm-actions">
            <button type="button" class="btn primary" data-testid="bp-started-close" (click)="closeStarted()">
              {{ 'common.understood' | translate }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .bp-modal-head {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.6rem;
        text-align: center;
      }
      .bp-modal-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: var(--pe-accent-soft, rgba(225, 78, 202, 0.14));
        color: var(--pe-accent, #e14eca);
      }
      .bp-modal-icon.ok {
        background: var(--pe-success-soft, rgba(53, 208, 127, 0.16));
        color: var(--pe-success, #35d07f);
      }
      .bp-modal-lead,
      .bp-modal-ask {
        text-align: center;
        line-height: 1.55;
      }
      .bp-modal-ask {
        font-weight: 600;
        margin-top: 0.4rem;
      }
      .confirm-actions {
        justify-content: center;
      }
      .confirm-actions .btn {
        min-width: 130px;
        justify-content: center;
      }
    `,
  ],
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
  /** 1ª modal (instrucciones) / 2ª modal (proceso iniciado). */
  protected readonly showInfo = signal(false);
  protected readonly showStarted = signal(false);

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

  /** Abre la modal de instrucciones (el envío NO es one-click). */
  protected openInfo(): void {
    this.error.set(null);
    this.showInfo.set(true);
  }

  /** Confirmación dentro de la modal de instrucciones → envía la solicitud. */
  protected confirmApply(): void {
    if (this.working()) return;
    this.working.set(true);
    this.error.set(null);
    this.promoters.apply().subscribe({
      next: (res) => {
        if (res.promoterStatus === 'approved') {
          this.showInfo.set(false);
          this.onApproved();
        } else {
          this.working.set(false);
          this.showInfo.set(false);
          this.view.set('pending');
          this.showStarted.set(true);
        }
      },
      error: () => {
        this.working.set(false);
        this.showInfo.set(false);
        this.error.set(this.translate.instant('becomePromoter.msgError'));
      },
    });
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
