import { Component, computed, HostListener, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { SessionStore } from '../../core/auth/session.store';

/**
 * Cabecera con navegación y área de sesión. El estado se hidrata en el cliente
 * (SSR anónimo → páginas públicas cacheables). El "Hola, {nombre}" va FUERA del
 * botón; el trigger es un icono de persona (o la foto del usuario si tiene) que
 * abre el menú desplegable con Perfil, accesos rápidos, panel y Salir.
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

  /** Foto del usuario si la tiene; null → el trigger cae al icono de persona. */
  protected readonly avatarUrl = computed(
    () => (this.session.user() as { avatarUrl?: string | null } | null)?.avatarUrl ?? null,
  );

  toggleMenu(): void {
    this.menuOpen.update((v) => !v);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  /**
   * Cierra el desplegable al hacer click FUERA del `.user-menu`. El click en el
   * propio trigger burbujea aquí, pero como está DENTRO de `.user-menu` no lo
   * cierra (el toggle ya lo abrió/cerró) → no hay abrir-y-cerrar en el mismo click.
   */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.menuOpen()) return;
    const target = event.target as HTMLElement | null;
    if (target && target.closest('.user-menu')) return;
    this.closeMenu();
  }

  /** Escape cierra el desplegable. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.menuOpen()) this.closeMenu();
  }

  logout(): void {
    this.closeMenu();
    this.auth.logout().subscribe({
      complete: () => void this.router.navigateByUrl('/'),
      error: () => void this.router.navigateByUrl('/'),
    });
  }
}
