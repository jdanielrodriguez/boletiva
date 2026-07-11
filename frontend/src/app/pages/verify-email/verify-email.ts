import { Component, OnDestroy, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ConfirmationSplashComponent } from '../../shared/ui/confirmation-splash.component';

/**
 * "Verifica tu correo" tras el registro (v3.9 · D2). Pantalla de confirmación
 * BONITA y TEMPORAL: sigue la misma línea que la de compra exitosa (icono en halo,
 * mensaje y loader integrado). A los ~20s redirige al inicio; el usuario puede
 * irse antes con el botón. SSR-safe: el temporizador solo corre en el navegador.
 */
@Component({
  selector: 'app-verify-email',
  imports: [TranslatePipe, ConfirmationSplashComponent],
  template: `
    <section class="verify-email">
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
    </section>
  `,
})
export class VerifyEmail implements OnDestroy {
  private static readonly REDIRECT_MS = 20000;

  private readonly router = inject(Router);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly leaving = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (this.isBrowser) {
      this.timer = setTimeout(() => {
        this.leaving.set(true);
        void this.router.navigateByUrl('/');
      }, VerifyEmail.REDIRECT_MS);
    }
  }

  ngOnDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}
