import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { API_BASE_URL, SITE_URL } from './core/config/api.tokens';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    // En SSR el API se resuelve por la red interna de Docker (no por localhost).
    {
      provide: API_BASE_URL,
      useFactory: () => process.env['API_URL_SERVER'] ?? 'http://pasaeventos_api:8080/api/v1',
    },
    {
      provide: SITE_URL,
      useFactory: () => process.env['PUBLIC_SITE_URL'] ?? 'http://localhost:4200',
    },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
