import { Component, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ConfirmationSplashComponent } from '../../shared/ui/confirmation-splash.component';
import { AuthService } from '../../core/auth/auth.service';

type PwlState = 'verifying' | 'error';

/**
 * Acceso PASSWORDLESS por enlace mágico (QA auth-H2). El correo trae `?token=`; esta
 * página lo consume contra `/auth/passwordless/token`, ARRANCA la sesión (applyLogin) y
 * redirige al inicio. Antes no existía la ruta `/passwordless` → el enlace era un 404.
 * Sin token o token inválido → error accesible con vuelta al login. SSR-safe.
 */
@Component({
  selector: 'app-passwordless',
  imports: [TranslatePipe, RouterLink, ConfirmationSplashComponent],
  template: `
    <section class="passwordless">
      @if (state() === 'verifying') {
        <app-confirmation-splash
          icon="mail"
          [title]="'shell.passwordlessTitle' | translate"
          [message]="'shell.passwordlessBody' | translate"
        />
      } @else {
        <app-confirmation-splash icon="mail" [title]="'shell.passwordlessTitle' | translate">
          <p role="alert" class="error" data-testid="pwl-error">{{ 'shell.passwordlessError' | translate }}</p>
          <a class="btn primary" routerLink="/login" data-testid="pwl-back-login">
            {{ 'shell.passwordlessBackLogin' | translate }}
          </a>
        </app-confirmation-splash>
      }
    </section>
  `,
})
export class Passwordless {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly state = signal<PwlState>('verifying');

  constructor() {
    if (!this.isBrowser) return;
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.state.set('error');
      return;
    }
    this.auth.passwordlessToken(token).subscribe({
      next: () => void this.router.navigateByUrl('/'), // sesión iniciada → al inicio
      error: () => this.state.set('error'),
    });
  }
}
