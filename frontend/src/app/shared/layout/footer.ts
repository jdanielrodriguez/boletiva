import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SessionStore } from '../../core/auth/session.store';

/**
 * Pie de página global: derechos reservados + menú, siempre al fondo (layout
 * sticky en styles.scss). El menú es sesión-aware: invitado → iniciar sesión /
 * crear cuenta; logueado → perfil / convertirse en promotor (este último se
 * oculta a quien ya es promotor o admin).
 */
@Component({
  selector: 'app-footer',
  imports: [RouterLink],
  template: `
    <footer class="site-footer">
      <div class="footer-inner">
        <p class="footer-copy">© 2026 Pasa Eventos · Todos los derechos reservados</p>
        <nav class="footer-menu" aria-label="Enlaces del pie">
          <a routerLink="/terminos">Términos y condiciones</a>
          @if (session.isAuthenticated()) {
            <a routerLink="/cuenta">Perfil</a>
            @if (!session.hasAnyRole(['promoter', 'admin'])) {
              <a routerLink="/cuenta/configuracion">Convertirse en promotor</a>
            }
          } @else {
            <a routerLink="/login">Iniciar sesión</a>
            <a routerLink="/registro">Crear cuenta</a>
          }
        </nav>
      </div>
    </footer>
  `,
})
export class Footer {
  protected readonly session = inject(SessionStore);
}
