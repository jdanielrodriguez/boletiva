import { Component, PLATFORM_ID, afterNextRender, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { Header } from './shared/layout/header';
import { Footer } from './shared/layout/footer';
import { ToastContainer } from './shared/ui/toast-container';
import { SessionStore } from './core/auth/session.store';
import { I18nService } from './core/i18n/i18n.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Header, Footer, ToastContainer],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly session = inject(SessionStore);
  private readonly i18n = inject(I18nService);

  constructor() {
    // Hidrata la sesión SOLO en el navegador: en SSR no hay tokens (localStorage)
    // y no queremos pegar a /auth/me en el servidor (rompería el cache público).
    if (isPlatformBrowser(this.platformId)) {
      this.session.ensureLoaded().subscribe();
    }
    // Aplica la preferencia de idioma DESPUÉS de la hidratación: el SSR y el
    // primer render del cliente van en español (calce exacto, sin warning); si
    // el usuario prefiere inglés, se cambia aquí (el pipe reacciona por signal).
    afterNextRender(() => this.i18n.hydratePreference());
  }
}
