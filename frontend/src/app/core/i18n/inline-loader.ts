import { Observable, of } from 'rxjs';
import { TranslateLoader, type TranslationObject } from '@ngx-translate/core';
import type { Lang } from './i18n.types';
import { es } from './locales/es';
import { en } from './locales/en';

const DICTIONARIES: Record<Lang, TranslationObject> = { es, en };

/**
 * Loader SÍNCRONO: los diccionarios se importan estáticamente (bundle), así que
 * `getTranslation` resuelve al instante con `of(...)`. Esto es clave para SSR +
 * zoneless: no hay HTTP ni asincronía → el idioma está disponible en el primer
 * render del servidor y del cliente, sin FOUC ni desajuste de hidratación y sin
 * necesitar TransferState.
 */
export class InlineTranslateLoader extends TranslateLoader {
  override getTranslation(lang: string): Observable<TranslationObject> {
    return of(DICTIONARIES[lang as Lang] ?? DICTIONARIES.es);
  }
}
