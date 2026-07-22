import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { SessionStore } from '../../core/auth/session.store';

/**
 * Pie de página global, siempre al fondo (layout sticky en styles.scss). v3.8:
 *  - CENTRO: bloque legal centrado → copyright arriba y "Términos y condiciones"
 *    centrado debajo.
 *  - LADO: el menú sesión-aware con sus ítems APILADOS (uno bajo otro): invitado
 *    → iniciar sesión / crear cuenta; cliente → Perfil + "Conviértete en
 *    promotor"; promotor/admin → Perfil + Configuración (a su consola).
 * En móvil todo se apila y centra.
 */
@Component({
  selector: 'app-footer',
  imports: [RouterLink, TranslatePipe],
  template: `
    <footer class="site-footer">
      <div class="footer-inner">
        <!-- IZQUIERDA: Preguntas frecuentes. CENTRO: copyright + Términos debajo. DERECHA: menú. -->
        <nav class="footer-help" [attr.aria-label]="'faq.title' | translate">
          <a routerLink="/faq" data-testid="footer-faq">{{ 'faq.title' | translate }}</a>
        </nav>
        <div class="footer-center">
          <p class="footer-copy">{{ 'shell.copyright' | translate: { year: year } }}</p>
          <nav class="footer-legal" [attr.aria-label]="'shell.legal' | translate">
            <a routerLink="/terminos">{{ 'shell.terms' | translate }}</a>
          </nav>
        </div>
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
            <a class="footer-cta" routerLink="/conviertete-en-promotor">{{
              'shell.becomePromoter' | translate
            }}</a>
            <a routerLink="/login">{{ 'shell.login' | translate }}</a>
            <a routerLink="/registro">{{ 'shell.createAccount' | translate }}</a>
          }
        </nav>
      </div>
    </footer>
  `,
})
export class Footer {
  protected readonly session = inject(SessionStore);
  /** Año dinámico para el copyright (evita que quede viejo). */
  protected readonly year = new Date().getFullYear();
}
