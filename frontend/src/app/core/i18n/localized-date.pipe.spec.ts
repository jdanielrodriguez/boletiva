import { EnvironmentInjector, provideZonelessChangeDetection, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18nService } from './i18n.service';
import { LocalizedDatePipe } from './localized-date.pipe';
import { provideI18nTesting } from './testing';

describe('LocalizedDatePipe', () => {
  let pipe: LocalizedDatePipe;
  let i18n: I18nService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), ...provideI18nTesting()],
    });
    const injector = TestBed.inject(EnvironmentInjector);
    runInInjectionContext(injector, () => {
      pipe = new LocalizedDatePipe();
    });
    i18n = TestBed.inject(I18nService);
    i18n.init();
  });

  // 2026-07-15T02:00:00Z = 2026-07-14 20:00 en Guatemala (UTC-6).
  const UTC = '2026-07-15T02:00:00.000Z';

  it('muestra la hora en zona de Guatemala, no UTC ni del navegador', () => {
    // El día local GT es 14, no 15 (comprueba conversión de zona).
    expect(pipe.transform(UTC, 'y-MM-dd HH:mm')).toBe('2026-07-14 20:00');
  });

  it('formatea con el locale español (es-GT) por defecto', () => {
    const out = pipe.transform(UTC, 'MMMM').toLowerCase();
    expect(out).toContain('julio');
  });

  it('formatea con el locale inglés (en-US) al cambiar idioma', () => {
    i18n.use('en');
    const out = pipe.transform(UTC, 'MMMM').toLowerCase();
    expect(out).toContain('july');
  });

  it('devuelve cadena vacía para null/undefined', () => {
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
  });
});
