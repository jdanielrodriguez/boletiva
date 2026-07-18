/**
 * Configuración del navegador para PRODUCCIÓN (se hornea en el bundle vía
 * `fileReplacements` de angular.json → configuración `production`). La imagen
 * Docker del frontend SOBREESCRIBE este archivo con los valores reales del deploy
 * (ARGs `API_BASE_URL_BROWSER` / `PUBLIC_SITE_URL`), así el mismo código sirve para
 * cualquier entorno sin recompilar el repo. Los valores de aquí son solo el DEFAULT
 * de alfa (backend en Cloud Run). Mantener SOLO lo que es seguro exponer al cliente.
 */
export const environment = {
  /** URL base del API para peticiones desde el navegador (incluye /api/v1). */
  apiBaseUrlBrowser: 'https://api.boletiva.com/api/v1',
  /** Origen público del sitio (para URLs canónicas / og:url). */
  siteUrl: 'https://boletiva.com',
} as const;
