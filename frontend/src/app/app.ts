import { Component, PLATFORM_ID, afterNextRender, computed, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { Header } from './shared/layout/header';
import { Footer } from './shared/layout/footer';
import { ToastContainer } from './shared/ui/toast-container';
import { LoadingComponent } from './shared/ui/loading.component';
import { SessionStore } from './core/auth/session.store';
import { TokenStore } from './core/auth/token-store.service';
import { I18nService } from './core/i18n/i18n.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Header, Footer, ToastContainer, LoadingComponent, TranslatePipe],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly session = inject(SessionStore);
  private readonly tokens = inject(TokenStore);
  private readonly i18n = inject(I18nService);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  /**
   * Carga fría en el navegador con marca de sesión: mostramos un overlay de
   * carga a pantalla completa hasta que /auth/me resuelva. Así evitamos el
   * PARPADEO de la pantalla de login en las consolas protegidas (F5 admin):
   * el SSR pudo renderizar el login anónimo, pero en vez de mostrarlo lo
   * tapamos con el loader mientras se hidrata la sesión.
   */
  protected readonly hydrating = computed(
    () => this.isBrowser && this.tokens.hasSessionHint() && !this.session.loaded(),
  );

  constructor() {
    // Hidrata la sesión SOLO en el navegador: en SSR no hay tokens (localStorage)
    // y no queremos pegar a /auth/me en el servidor (rompería el cache público).
    if (isPlatformBrowser(this.platformId)) {
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
