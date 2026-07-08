/**
 * Configuración del navegador (se hornea en el bundle). En SSR el valor se
 * resuelve aparte desde process.env (ver app.config.server.ts). Mantener aquí
 * SOLO lo que es seguro exponer al cliente.
 */
export const environment = {
  /** URL base del API para peticiones desde el navegador. */
  apiBaseUrlBrowser: 'http://localhost:8080/api/v1',
} as const;
