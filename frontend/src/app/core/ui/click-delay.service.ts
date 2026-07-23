import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PublicConfigStore } from '../config/public-config.store';
import { SessionStore } from '../auth/session.store';

/**
 * Delay artificial en clics (UX): al hacer clic en un botón/enlace, muestra un breve
 * indicador de carga para que la acción se sienta más sólida ("está pasando algo").
 * Solo aplica a CLIENTES y VISITANTES (no admin/promotor/asesor) y es
 * admin-configurable (`ux.click_delay_enabled` / `ux.click_delay_ms` vía /public/config).
 * Es COSMÉTICO: no cancela ni re-dispara el clic (no `preventDefault`); solo pinta un
 * velo durante `delayMs`. El admin puede desactivarlo en cualquier momento.
 */
@Injectable({ providedIn: 'root' })
export class ClickDelayService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly config = inject(PublicConfigStore);
  private readonly session = inject(SessionStore);

  /** true mientras se muestra el velo tras un clic (el AppComponent lo pinta). */
  readonly active = signal(false);

  private installed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Instala el listener global (una sola vez, solo en navegador). */
  install(): void {
    if (this.installed || !isPlatformBrowser(this.platformId)) return;
    this.installed = true;
    // Fase de captura: corre antes que los handlers del botón, pero NO detiene el clic.
    document.addEventListener('click', (e) => this.onClick(e), true);
  }

  private appliesToUser(): boolean {
    // Solo cliente/visitante: staff (admin/promotor/asesor) no sufre el delay.
    return !this.session.hasAnyRole(['admin', 'promoter', 'advisor']);
  }

  private onClick(e: Event): void {
    if (!this.config.clickDelayEnabled()) return;
    const ms = this.config.clickDelayMs();
    if (ms <= 0 || !this.appliesToUser()) return;
    const target = e.target as HTMLElement | null;
    // Solo controles interactivos (botón/enlace/.btn/role=button); ignora texto/inputs.
    if (!target?.closest('button, a[href], .btn, [role="button"]')) return;

    this.active.set(true);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.active.set(false), ms);
  }
}
