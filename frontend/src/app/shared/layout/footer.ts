import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Pie de página global: menú (términos, login, registro) + derechos reservados,
 * siempre al fondo de la pantalla (ver layout sticky en styles.scss). */
@Component({
  selector: 'app-footer',
  imports: [RouterLink],
  template: `
    <footer class="site-footer">
      <nav class="footer-menu" aria-label="Enlaces del pie">
        <a routerLink="/terminos">Términos y condiciones</a>
        <a routerLink="/login">Iniciar sesión</a>
        <a routerLink="/registro">Crear cuenta</a>
      </nav>
      <p class="footer-copy">© 2026 Pasa Eventos · Todos los derechos reservados</p>
    </footer>
  `,
})
export class Footer {}
