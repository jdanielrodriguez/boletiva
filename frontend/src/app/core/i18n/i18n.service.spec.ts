import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { I18nService } from './i18n.service';
import { LANG_STORAGE_KEY } from './i18n.types';
import { provideI18nTesting } from './testing';

describe('I18nService', () => {
  function make(): I18nService {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), ...provideI18nTesting()],
    });
    return TestBed.inject(I18nService);
  }

  beforeEach(() => {
    localStorage.removeItem(LANG_STORAGE_KEY);
  });

  it('arranca en español por defecto (es-GT)', () => {
    const i18n = make();
    i18n.init();
    expect(i18n.lang()).toBe('es');
    expect(i18n.locale()).toBe('es-GT');
  });

  it('cambia el idioma a inglés y actualiza el locale a en-US', () => {
    const i18n = make();
    i18n.init();
    i18n.use('en');
    expect(i18n.lang()).toBe('en');
    expect(i18n.locale()).toBe('en-US');
    expect(TestBed.inject(TranslateService).getCurrentLang()).toBe('en');
  });

  it('persiste la preferencia en localStorage', () => {
    const i18n = make();
    i18n.init();
    i18n.use('en');
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('en');
  });

  it('hydratePreference aplica el idioma guardado tras la hidratación', () => {
    localStorage.setItem(LANG_STORAGE_KEY, 'en');
    const i18n = make();
    i18n.init();
    expect(i18n.lang()).toBe('es'); // primer render = default (calce SSR)
    i18n.hydratePreference();
    expect(i18n.lang()).toBe('en');
  });

  it('ignora un idioma no soportado y cae al default', () => {
    const i18n = make();
    i18n.init();
    i18n.use('fr' as unknown as 'es');
    expect(i18n.lang()).toBe('es');
  });

  it('traduce claves reales en el idioma activo', () => {
    const i18n = make();
    i18n.init();
    const t = TestBed.inject(TranslateService);
    expect(t.instant('shell.navEvents')).toBe('Eventos');
    i18n.use('en');
    expect(t.instant('shell.navEvents')).toBe('Events');
  });
});
