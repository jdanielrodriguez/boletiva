import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AdvisorInvitationsApi } from '../../core/api/advisor-invitations.api';
import { SessionStore } from '../../core/auth/session.store';
import { ToastService } from '../../core/ui/toast.service';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { LoadingComponent } from '../../shared/ui/loading.component';

/**
 * Onboarding de asesor (T7e). Mismo componente para dos rutas:
 *  - /asesor/fijar-password → usuario NUEVO: fija contraseña (con repetición+validación).
 *  - /asesor/confirmar      → usuario EXISTENTE: confirma su nuevo rol (requiere sesión).
 * Valida el token con `peek` y ramifica según `needsPassword`.
 */
@Component({
  selector: 'app-advisor-onboarding',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslatePipe, EmptyStateComponent, LoadingComponent],
  template: `
    <section class="advisor-onboarding auth-card-narrow">
      <h1>{{ 'advisor.onboarding.title' | translate }}</h1>

      @if (loading()) {
        <app-loading [label]="'common.loading' | translate" data-testid="adv-loading" />
      } @else if (invalid()) {
        <app-empty-state variant="generic" data-testid="adv-invalid"
          [title]="'advisor.onboarding.invalidTitle' | translate"
          [subtitle]="'advisor.onboarding.invalidBody' | translate" />
      } @else if (done()) {
        <app-empty-state variant="card" data-testid="adv-done"
          [title]="'advisor.onboarding.doneTitle' | translate"
          [subtitle]="'advisor.onboarding.doneBody' | translate"
          [ctaLabel]="'advisor.onboarding.goLogin' | translate" ctaLink="/login" />
      } @else if (needsPassword()) {
        <p class="muted">{{ 'advisor.onboarding.setPasswordHint' | translate: { email: email() } }}</p>
        <form class="stacked-form" (ngSubmit)="submitPassword()">
          <div class="field">
            <label for="adv-pw">{{ 'advisor.onboarding.password' | translate }}</label>
            <input id="adv-pw" type="password" [ngModel]="pw()" (ngModelChange)="pw.set($event)" name="pw" autocomplete="new-password" data-testid="adv-pw" />
          </div>
          <div class="field">
            <label for="adv-pw2">{{ 'advisor.onboarding.repeat' | translate }}</label>
            <input id="adv-pw2" type="password" [ngModel]="pw2()" (ngModelChange)="pw2.set($event)" name="pw2" autocomplete="new-password" data-testid="adv-pw2" />
          </div>
          @if (pwError(); as e) { <p class="error" role="alert" data-testid="adv-pw-error">{{ e | translate }}</p> }
          <button type="submit" class="btn primary" [disabled]="!canSubmit() || working()" data-testid="adv-set-password">
            {{ working() ? ('common.sending' | translate) : ('advisor.onboarding.activate' | translate) }}
          </button>
        </form>
      } @else {
        <!-- Usuario existente: confirmar rol (requiere sesión con el mismo correo). -->
        <p class="muted">{{ 'advisor.onboarding.confirmHint' | translate: { email: email() } }}</p>
        @if (session.isAuthenticated()) {
          <button type="button" class="btn primary" [disabled]="working()" (click)="confirm()" data-testid="adv-confirm">
            {{ working() ? ('common.sending' | translate) : ('advisor.onboarding.confirm' | translate) }}
          </button>
        } @else {
          <app-empty-state variant="generic"
            [title]="'advisor.onboarding.loginNeededTitle' | translate"
            [subtitle]="'advisor.onboarding.loginNeededBody' | translate"
            [ctaLabel]="'advisor.onboarding.goLogin' | translate" ctaLink="/login" />
        }
      }
    </section>
  `,
})
export class AdvisorOnboardingPage {
  private readonly api = inject(AdvisorInvitationsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly toasts = inject(ToastService);
  protected readonly session = inject(SessionStore);

  private readonly token = this.route.snapshot.queryParamMap.get('token') ?? '';
  protected readonly loading = signal(true);
  protected readonly invalid = signal(false);
  protected readonly done = signal(false);
  protected readonly needsPassword = signal(false);
  protected readonly email = signal('');
  protected readonly working = signal(false);
  protected readonly pw = signal('');
  protected readonly pw2 = signal('');

  protected readonly pwError = computed<string | null>(() => {
    if (this.pw().length > 0 && this.pw().length < 8) return 'advisor.onboarding.errShort';
    if (this.pw2().length > 0 && this.pw() !== this.pw2()) return 'advisor.onboarding.errMismatch';
    return null;
  });
  protected readonly canSubmit = computed(() => this.pw().length >= 8 && this.pw() === this.pw2());

  constructor() {
    if (!this.token) {
      this.invalid.set(true);
      this.loading.set(false);
    } else {
      this.api.peek(this.token).subscribe({
        next: (p) => {
          this.email.set(p.email);
          this.needsPassword.set(p.needsPassword);
          this.loading.set(false);
        },
        error: () => {
          this.invalid.set(true);
          this.loading.set(false);
        },
      });
    }
  }

  protected submitPassword(): void {
    if (!this.canSubmit() || this.working()) return;
    this.working.set(true);
    this.api.setPassword(this.token, this.pw()).subscribe({
      next: () => {
        this.working.set(false);
        this.done.set(true);
      },
      error: () => {
        this.working.set(false);
        this.toasts.error(this.translate.instant('advisor.onboarding.error'));
      },
    });
  }

  protected confirm(): void {
    if (this.working()) return;
    this.working.set(true);
    this.api.accept(this.token).subscribe({
      next: () => {
        this.working.set(false);
        this.toasts.success(this.translate.instant('advisor.onboarding.confirmed'));
        void this.router.navigateByUrl('/soporte');
      },
      error: () => {
        this.working.set(false);
        this.toasts.error(this.translate.instant('advisor.onboarding.error'));
      },
    });
  }
}
