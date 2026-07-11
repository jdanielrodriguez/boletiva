import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

import { routes } from './app.routes';
import { API_BASE_URL, SITE_URL } from './core/config/api.tokens';
import { environment } from './core/config/environment';
import { authInterceptor } from './core/http/auth.interceptor';
import { maintenanceInterceptor } from './core/http/maintenance.interceptor';
import { provideI18n } from './core/i18n/i18n.providers';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    // anchorScrolling: links con fragmento (p.ej. /terminos#reembolsos) desplazan
    // a la sección; scrollPositionRestoration devuelve al tope al navegar.
    provideRouter(
      routes,
      withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' }),
    ),
    provideClientHydration(withEventReplay()),
    // i18n runtime (ngx-translate) + locales es-GT/en-US. SSR-safe (loader inline).
    ...provideI18n(),
    // withFetch: requerido para SSR (usa la API fetch, sin XHR).
    // maintenanceInterceptor va DESPUÉS del auth: queda más cerca del backend y
    // detecta el 503 de mantenimiento incluso en los reintentos del refresh.
    provideHttpClient(withFetch(), withInterceptors([authInterceptor, maintenanceInterceptor])),
    // Valor de navegador; el servidor lo sobreescribe en app.config.server.ts.
    { provide: API_BASE_URL, useValue: environment.apiBaseUrlBrowser },
    { provide: SITE_URL, useValue: environment.siteUrl },
  ],
};
