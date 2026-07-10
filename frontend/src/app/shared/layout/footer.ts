import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { SessionStore } from '../../core/auth/session.store';

/**
 * Pie de página global, siempre al fondo (layout sticky en styles.scss). Dos filas:
 *  - ARRIBA: a la izquierda espacio de marca (vacío por ahora) y a la derecha el
 *    copyright.
 *  - ABAJO: a la izquierda Términos y condiciones y a la derecha el menú
 *    sesión-aware (invitado → iniciar sesión / crear cuenta; cliente → Perfil +
 *    "Conviértete en promotor"; promotor/admin → Perfil + Configuración, cada uno
 *    a su consola).
 * En móvil ambas filas se apilan y centran.
 */
@Component({
  selector: 'app-footer',
  imports: [RouterLink, TranslatePipe],
  template: `
    <footer class="site-footer">
      <div class="footer-inner">
        <div class="footer-row footer-row--top">
          <div class="footer-brand" aria-hidden="true"></div>
          <p class="footer-copy">{{ 'shell.copyright' | translate }}</p>
        </div>
        <div class="footer-row footer-row--bottom">
          <nav class="footer-legal" [attr.aria-label]="'shell.legal' | translate">
            <a routerLink="/terminos">{{ 'shell.terms' | translate }}</a>
          </nav>
          <nav class="footer-menu" [attr.aria-label]="'shell.footerMenu' | translate">
            @if (session.isAuthenticated()) {
              <a routerLink="/cuenta">{{ 'shell.profile' | translate }}</a>
              @if (session.hasAnyRole(['admin'])) {
                <a routerLink="/configuracion">{{ 'shell.configuration' | translate }}</a>
              } @else if (session.hasAnyRole(['promoter'])) {
                <a routerLink="/promotor">{{ 'shell.configuration' | translate }}</a>
              } @else {
                <a class="footer-cta" routerLink="/conviertete-en-promotor">{{
                  'shell.becomePromoter' | translate
                }}</a>
              }
            } @else {
              <a routerLink="/login">{{ 'shell.login' | translate }}</a>
              <a routerLink="/registro">{{ 'shell.createAccount' | translate }}</a>
            }
          </nav>
        </div>
      </div>
    </footer>
  `,
})
export class Footer {
  protected readonly session = inject(SessionStore);
}
