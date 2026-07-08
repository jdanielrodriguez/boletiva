import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { SessionStore } from '../../core/auth/session.store';

/**
 * Cabecera con navegación y área de sesión. El estado de sesión se hidrata en el
 * cliente (SSR siempre renderiza anónimo → las páginas públicas son cacheables
 * en el edge). Tras hidratar, los signals actualizan el header sin recargar.
 */
@Component({
  selector: 'app-header',
  imports: [RouterLink],
  templateUrl: './header.html',
})
export class Header {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly session = inject(SessionStore);

  logout(): void {
    this.auth.logout().subscribe({
      complete: () => void this.router.navigateByUrl('/'),
      error: () => void this.router.navigateByUrl('/'),
    });
  }
}
