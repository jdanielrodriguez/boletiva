import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { SessionStore } from '../../core/auth/session.store';

/**
 * Cabecera con navegación y área de sesión. El estado se hidrata en el cliente
 * (SSR anónimo → páginas públicas cacheables). El nombre del usuario abre un
 * menú desplegable con Perfil, Configuraciones y Salir.
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

  protected readonly menuOpen = signal(false);

  toggleMenu(): void {
    this.menuOpen.update((v) => !v);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  logout(): void {
    this.closeMenu();
    this.auth.logout().subscribe({
      complete: () => void this.router.navigateByUrl('/'),
      error: () => void this.router.navigateByUrl('/'),
    });
  }
}
