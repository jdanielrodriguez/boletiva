import { InjectionToken } from '@angular/core';

/**
 * URL base del API (incluye el prefijo /api/v1). Se provee con valor distinto en
 * navegador y en servidor (SSR): en el navegador apunta al host (localhost:8080),
 * en SSR apunta al API por la red interna de Docker (pasaeventos_api:8080). Así
 * la resolución es por DI y no por chequeos de plataforma dispersos en el código.
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL');
