import { Component, OnDestroy, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ConfirmationSplashComponent } from '../../shared/ui/confirmation-splash.component';
import { AuthService } from '../../core/auth/auth.service';

type VerifyState = 'idle' | 'verifying' | 'verified' | 'error';

/**
 * "Verifica tu correo" (v3.9 · D2 + QA auth-H1). Dos modos según la URL:
 *  - SIN `?token=`: pantalla de confirmación tras el registro ("te enviamos el enlace"),
 *    redirige al inicio a los ~20s.
 *  - CON `?token=` (enlace mágico del correo): CONSUME el token contra el backend
 *    (`/auth/verify-email/token`) y muestra verificado/expirado. Antes la ruta del enlace
 *    (`/verify-email`) ni existía (404) y la página no leía el token → el enlace no verificaba.
 * SSR-safe: el temporizador y la llamada solo corren en el navegador.
 */
@Component({
  selector: 'app-verify-email',
  imports: [TranslatePipe, ConfirmationSplashComponent],
  template: `
    <section class="verify-email">
      @if (state() === 'verifying') {
        <app-confirmation-splash
          icon="mail"
          [title]="'shell.verifyTitle' | translate"
          [message]="'shell.verifyingBody' | translate"
        />
      } @else if (state() === 'verified') {
        <app-confirmation-splash
          icon="check"
          [title]="'shell.verifiedTitle' | translate"
          [message]="'shell.verifiedBody' | translate"
          [redirectLabel]="'shell.verifyRedirecting' | translate"
        >
          <a class="btn primary" href="/" data-testid="verify-back-home">
            {{ 'shell.verifyBackHome' | translate }}
          </a>
        </app-confirmation-splash>
      } @else if (state() === 'error') {
        <app-confirmation-splash icon="mail" [title]="'shell.verifyTitle' | translate">
          <p role="alert" class="error" data-testid="verify-error">{{ 'shell.verifyError' | translate }}</p>
          <a class="btn primary" href="/" data-testid="verify-back-home">
            {{ 'shell.verifyBackHome' | translate }}
          </a>
        </app-confirmation-splash>
      } @else {
        <app-confirmation-splash
          icon="mail"
          [title]="'shell.verifyTitle' | translate"
          [message]="'shell.verifyBody' | translate"
          [redirectLabel]="'shell.verifyRedirecting' | translate"
        >
          <a class="btn primary" href="/" data-testid="verify-back-home">
            {{ 'shell.verifyBackHome' | translate }}
          </a>
        </app-confirmation-splash>
      }
    </section>
  `,
})
export class VerifyEmail implements OnDestroy {
  private static readonly REDIRECT_MS = 20000;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly state = signal<VerifyState>('idle');
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (!this.isBrowser) return;
    const token = this.route.snapshot.queryParamMap.get('token');
    if (token) {
      // Enlace mágico: consume el token y verifica de verdad.
      this.state.set('verifying');
      this.auth.verifyEmailToken(token).subscribe({
        next: () => {
          this.state.set('verified');
          this.armRedirect();
        },
        error: () => this.state.set('error'), // enlace inválido/expirado → sin redirección
      });
    } else {
      // Sin token: confirmación post-registro (el usuario verifica con el código del modal).
      this.armRedirect();
    }
  }

  private armRedirect(): void {
    this.timer = setTimeout(() => void this.router.navigateByUrl('/'), VerifyEmail.REDIRECT_MS);
  }

  ngOnDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}
