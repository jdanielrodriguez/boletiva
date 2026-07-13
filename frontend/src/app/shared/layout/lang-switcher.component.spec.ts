import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SessionStore } from '../../core/auth/session.store';
import { API_BASE_URL } from '../../core/config/api.tokens';
import { PublicConfigStore } from '../../core/config/public-config.store';
import { I18nService } from '../../core/i18n/i18n.service';
import { provideI18nTesting } from '../../core/i18n/testing';
import { LangSwitcherComponent } from './lang-switcher.component';

/** Stub del store de config pública con el flag de idioma controlable por el test. */
function stubConfig(allow: boolean): Partial<PublicConfigStore> {
  return { allowVisitorLangSwitch: signal(allow).asReadonly() } as Partial<PublicConfigStore>;
}

describe('LangSwitcherComponent', () => {
  let fixture: ComponentFixture<LangSwitcherComponent>;
  let i18n: I18nService;

  function setup(allowVisitorSwitch: boolean): void {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://test.local/api/v1' },
        { provide: PublicConfigStore, useValue: stubConfig(allowVisitorSwitch) },
        ...provideI18nTesting(),
      ],
    });
    i18n = TestBed.inject(I18nService);
    i18n.init();
    fixture = TestBed.createComponent(LangSwitcherComponent);
    fixture.detectChanges();
  }

  it('muestra ambas banderas', () => {
    setup(true);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="lang-es"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="lang-en"]')).not.toBeNull();
  });

  it('marca español como activo por defecto', () => {
    setup(true);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="lang-es"]')?.classList.contains('active')).toBe(true);
    expect(el.querySelector('[data-testid="lang-en"]')?.classList.contains('active')).toBe(false);
  });

  it('visitante con el flag ACTIVO puede cambiar a inglés', () => {
    setup(true);
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('[data-testid="lang-en"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(i18n.lang()).toBe('en');
    expect(el.querySelector('[data-testid="lang-en"]')?.classList.contains('active')).toBe(true);
    expect(el.querySelector('[data-testid="lang-es"]')?.classList.contains('active')).toBe(false);
  });

  it('vuelve a español al hacer click en la bandera de Guatemala', () => {
    setup(true);
    const el = fixture.nativeElement as HTMLElement;
    i18n.use('en');
    fixture.detectChanges();
    (el.querySelector('[data-testid="lang-es"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(i18n.lang()).toBe('es');
  });

  it('con el flag INACTIVO: el selector de idioma queda OCULTO (W10)', () => {
    setup(false);
    const el = fixture.nativeElement as HTMLElement;
    // Sin el flag, el switcher no se renderiza en absoluto.
    expect(el.querySelector('[data-testid="lang-switcher"]')).toBeNull();
    expect(el.querySelector('[data-testid="lang-en"]')).toBeNull();
    expect(i18n.lang()).toBe('es');
  });

  it('con el flag INACTIVO el selector queda OCULTO también para el logueado (W10)', () => {
    setup(false);
    const session = TestBed.inject(SessionStore);
    session.setUser({ id: 'u1', email: 'x@y.z', roles: ['buyer'], language: 'es' } as never);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="lang-switcher"]')).toBeNull();
  });

  it('el toggle es EFÍMERO: NO persiste en BD (sin PATCH /users/me) (W1)', () => {
    setup(true);
    const http = TestBed.inject(HttpTestingController);
    const session = TestBed.inject(SessionStore);
    session.setUser({ id: 'u1', email: 'x@y.z', roles: ['buyer'], language: 'es' } as never);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('[data-testid="lang-en"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    // El idioma cambió en la sesión...
    expect(i18n.lang()).toBe('en');
    // ...pero NO se emitió ningún PATCH al perfil.
    http.expectNone((r) => r.url.endsWith('/users/me') && r.method === 'PATCH');
    http.verify();
  });
});
