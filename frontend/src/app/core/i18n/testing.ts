import {
  type EnvironmentProviders,
  EnvironmentInjector,
  type Provider,
  runInInjectionContext,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideI18n } from './i18n.providers';
import { I18nService } from './i18n.service';

/**
 * Providers de i18n para specs. Úsalo en cualquier `TestBed` cuyo componente
 * renderice el pipe `translate` o `localizedDate`. El loader es SÍNCRONO y el
 * idioma por defecto es español → el texto renderizado en tests es el español
 * de siempre (las aserciones existentes por texto/data-testid siguen pasando).
 *
 * Uso:
 *   TestBed.configureTestingModule({ providers: [ ...provideI18nTesting(), ... ] });
 *   // luego, antes de createComponent:
 *   initI18nTesting();
 */
export function provideI18nTesting(): (Provider | EnvironmentProviders)[] {
  return provideI18n();
}

/**
 * Inicializa el I18nService en el TestBed (por si el app initializer no corrió
 * aún). Idempotente y síncrono. Llamar tras configureTestingModule y antes de
 * createComponent.
 */
export function initI18nTesting(): void {
  const injector = TestBed.inject(EnvironmentInjector);
  runInInjectionContext(injector, () => {
    TestBed.inject(I18nService).init();
  });
}
