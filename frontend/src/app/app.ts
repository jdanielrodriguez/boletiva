import { Component, PLATFORM_ID, afterNextRender, computed, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { Header } from './shared/layout/header';
import { Footer } from './shared/layout/footer';
import { ToastContainer } from './shared/ui/toast-container';
import { LoadingComponent } from './shared/ui/loading.component';
import { MaintenancePageComponent } from './shared/maintenance/maintenance-page.component';
import { MaintenanceBannerComponent } from './shared/maintenance/maintenance-banner.component';
import { ImpersonationBannerComponent } from './shared/layout/impersonation-banner.component';
import { SessionStore } from './core/auth/session.store';
import { TokenStore } from './core/auth/token-store.service';
import { MaintenanceStore } from './core/maintenance/maintenance.store';
import { I18nService } from './core/i18n/i18n.service';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    Header,
    Footer,
    ToastContainer,
    LoadingComponent,
    MaintenancePageComponent,
    MaintenanceBannerComponent,
    ImpersonationBannerComponent,
    TranslatePipe,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly session = inject(SessionStore);
  private readonly tokens = inject(TokenStore);
  private readonly maintenance = inject(MaintenanceStore);
  private readonly i18n = inject(I18nService);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  protected readonly maintMessage = this.maintenance.message;

  /** ¿El usuario resuelto es admin? (para el bypass del mantenimiento). */
  private readonly isAdmin = computed(() => this.session.roles().includes('admin'));

  /**
   * Arranque en el navegador: tapamos con el loader mientras NO sepamos (a) el
   * estado de mantenimiento y (b) quién es el usuario (si hay marca de sesión).
   * Así evitamos el PARPADEO de la pantalla de login/contenido antes de decidir si
   * hay que mostrar la página de mantenimiento (F5 admin incluido).
   */
  protected readonly booting = computed(
    () =>
      this.isBrowser &&
      (!this.maintenance.loaded() ||
        (this.tokens.hasSessionHint() && !this.session.loaded())),
  );

  /** Página de mantenimiento bloqueante: mantenimiento activo y NO-admin. */
  protected readonly showMaintenancePage = computed(
    () => this.isBrowser && !this.booting() && this.maintenance.active() && !this.isAdmin(),
  );

  /** Banner superior: mantenimiento activo y el usuario ES admin (no bloquea). */
  protected readonly showAdminBanner = computed(
    () => this.isBrowser && !this.booting() && this.maintenance.active() && this.isAdmin(),
  );

  constructor() {
    // Hidrata sesión y consulta el mantenimiento SOLO en el navegador: en SSR no
    // hay tokens (localStorage) y no queremos pegar al API en el servidor (rompería
    // el cache público de las páginas anónimas).
    if (this.isBrowser) {
      this.maintenance.load();
      this.session.ensureLoaded().subscribe((user) => {
        // La preferencia de idioma GUARDADA del usuario manda sobre la de
        // localStorage: al resolver la sesión aplicamos su idioma de BD (v3.7).
        const lang = user?.language;
        if (lang === 'es' || lang === 'en') this.i18n.use(lang);
      });
    }
    // Aplica la preferencia de idioma DESPUÉS de la hidratación: el SSR y el
    // primer render del cliente van en español (calce exacto, sin warning); si
    // el usuario prefiere inglés, se cambia aquí (el pipe reacciona por signal).
    afterNextRender(() => this.i18n.hydratePreference());
  }
}
