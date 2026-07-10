import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
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
  imports: [RouterLink],
  template: `
    <footer class="site-footer">
      <div class="footer-inner">
        <nav class="footer-menu" aria-label="Enlaces del pie">
          @if (session.isAuthenticated()) {
            <a routerLink="/cuenta">Perfil</a>
            @if (session.hasAnyRole(['admin'])) {
              <a routerLink="/configuracion">Configuración</a>
            } @else if (session.hasAnyRole(['promoter'])) {
              <a routerLink="/promotor">Configuración</a>
            }
          } @else {
            <a routerLink="/login">Iniciar sesión</a>
            <a routerLink="/registro">Crear cuenta</a>
          }
        </nav>
        <p class="footer-copy">© 2026 Pasa Eventos · Todos los derechos reservados</p>
        <nav class="footer-legal" aria-label="Legal">
          <a routerLink="/terminos">Términos y condiciones</a>
        </nav>
      </div>
    </footer>
  `,
})
export class Footer {
  protected readonly session = inject(SessionStore);
}
