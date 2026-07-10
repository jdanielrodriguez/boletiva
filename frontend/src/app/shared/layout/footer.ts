import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { SessionStore } from '../../core/auth/session.store';

/**
 * Pie de página global, siempre al fondo (layout sticky en styles.scss). Orden
 * vertical: ARRIBA el menú sesión-aware (invitado → iniciar sesión / crear cuenta;
 * cliente → solo Perfil; promotor/admin → Perfil + Configuración, cada uno a su
 * consola), luego el copyright CENTRADO y por ÚLTIMO, hasta abajo, el enlace legal
 * de Términos y condiciones.
 */
@Component({
  selector: 'app-footer',
  imports: [RouterLink, TranslatePipe],
  template: `
    <footer class="site-footer">
      <div class="footer-inner">
        <nav class="footer-menu" [attr.aria-label]="'shell.footerMenu' | translate">
          @if (session.isAuthenticated()) {
            <a routerLink="/cuenta">{{ 'shell.profile' | translate }}</a>
            @if (session.hasAnyRole(['admin'])) {
              <a routerLink="/configuracion">{{ 'shell.configuration' | translate }}</a>
            } @else if (session.hasAnyRole(['promoter'])) {
              <a routerLink="/promotor">{{ 'shell.configuration' | translate }}</a>
            }
          } @else {
            <a routerLink="/login">{{ 'shell.login' | translate }}</a>
            <a routerLink="/registro">{{ 'shell.createAccount' | translate }}</a>
          }
        </nav>
        <p class="footer-copy">{{ 'shell.copyright' | translate }}</p>
        <nav class="footer-legal" [attr.aria-label]="'shell.legal' | translate">
          <a routerLink="/terminos">{{ 'shell.terms' | translate }}</a>
        </nav>
      </div>
    </footer>
  `,
})
export class Footer {
  protected readonly session = inject(SessionStore);
}
