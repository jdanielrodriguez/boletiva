/** Idiomas soportados. El default del sistema es español. */
export type Lang = 'es' | 'en';

export const SUPPORTED_LANGS: readonly Lang[] = ['es', 'en'] as const;

export const DEFAULT_LANG: Lang = 'es';

/**
 * Código de locale de Angular por idioma. Español → Guatemala (`es-GT`),
 * inglés → EE. UU. (`en-US`). Se usan para `registerLocaleData`, el `LOCALE_ID`
 * y el formateo de fechas/números.
 */
export const LOCALE_BY_LANG: Record<Lang, string> = {
  es: 'es-GT',
  en: 'en-US',
};

/**
 * Zona horaria de los eventos: SIEMPRE hora local de Guatemala.
 * `formatDate`/`DatePipe` de Angular NO acepta nombres IANA ('America/Guatemala'),
 * solo offsets → usamos `-0600`. Guatemala es UTC-6 fijo TODO el año (no observa
 * horario de verano desde 2006), así que el offset fijo es exacto y estable
 * independientemente de la zona del navegador.
 */
export const EVENT_TIME_ZONE = '-0600';

/** Clave de persistencia de la preferencia de idioma (localStorage + cookie). */
export const LANG_STORAGE_KEY = 'pe_lang';
