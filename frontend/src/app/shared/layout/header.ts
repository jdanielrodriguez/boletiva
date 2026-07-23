import { Component, computed, HostListener, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { catchError, defaultIfEmpty, forkJoin, of, timer } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { SessionStore } from '../../core/auth/session.store';
import { LoadingStore } from '../../core/ui/loading.store';
import { LangSwitcherComponent } from './lang-switcher.component';
import { ThemeSwitcherComponent } from './theme-switcher.component';
import { NotificationBellComponent } from '../notifications/notification-bell.component';
import { IconComponent } from '../icon/icon.component';

/**
 * Cabecera con navegación y área de sesión. El estado se hidrata en el cliente
 * (SSR anónimo → páginas públicas cacheables). El "Hola, {nombre}" va FUERA del
 * botón; el trigger es un icono de persona (o la foto del usuario si tiene) que
 * abre el menú desplegable con Perfil, accesos rápidos, panel y Salir.
 */
@Component({
  selector: 'app-header',
  imports: [RouterLink, TranslatePipe, LangSwitcherComponent, ThemeSwitcherComponent, NotificationBellComponent, IconComponent],
  templateUrl: './header.html',
})
export class Header {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly loading = inject(LoadingStore);
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
    // Overlay global BLOQUEANTE + espera MÍNIMA de 1s: el logout real suele ser
    // instantáneo, pero mostramos el loader un momento para que el cierre se perciba
    // deliberado. `startBlocking` CAPTURA los clics (F1) → el usuario no puede tocar
    // la UI a medio cierre de sesión (antes el overlay dejaba pasar el clic).
    this.loading.startBlocking();
    // `defaultIfEmpty`: el logout puede COMPLETAR sin emitir (204) → garantiza una
    // emisión para que forkJoin dispare aunque no venga cuerpo.
    forkJoin([
      this.auth.logout().pipe(
        catchError(() => of(void 0)),
        defaultIfEmpty(void 0),
      ),
      timer(1000),
    ]).subscribe({
      next: () => {
        this.loading.stopBlocking();
        void this.router.navigateByUrl('/');
      },
    });
  }
}
