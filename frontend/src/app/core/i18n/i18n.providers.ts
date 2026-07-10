import { registerLocaleData } from '@angular/common';
import localeEn from '@angular/common/locales/en';
import localeEsGt from '@angular/common/locales/es-GT';
import {
  type EnvironmentProviders,
  LOCALE_ID,
  type Provider,
  provideAppInitializer,
  inject,
} from '@angular/core';
import { provideTranslateLoader, provideTranslateService } from '@ngx-translate/core';
import { I18nService } from './i18n.service';
import { InlineTranslateLoader } from './inline-loader';
import { DEFAULT_LANG, LOCALE_BY_LANG } from './i18n.types';

// Datos de locale (formatos de fecha/número) para español-Guatemala e inglés-EEUU.
registerLocaleData(localeEsGt);
registerLocaleData(localeEn);

/**
 * Providers de i18n para toda la app (navegador y SSR). ngx-translate runtime
 * con loader inline síncrono (SSR-safe, sin HTTP/TransferState). `LOCALE_ID`
 * default = `es-GT` (los pipes reactivos usan `I18nService.locale()`).
 */
export function provideI18n(): (Provider | EnvironmentProviders)[] {
  return [
    provideTranslateService({
      loader: provideTranslateLoader(InlineTranslateLoader),
      fallbackLang: DEFAULT_LANG,
      lang: DEFAULT_LANG,
    }),
    { provide: LOCALE_ID, useValue: LOCALE_BY_LANG[DEFAULT_LANG] },
    provideAppInitializer(() => {
      inject(I18nService).init();
    }),
  ];
}
