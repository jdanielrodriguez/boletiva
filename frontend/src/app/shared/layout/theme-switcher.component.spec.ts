import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SessionStore } from '../../core/auth/session.store';
import { API_BASE_URL } from '../../core/config/api.tokens';
import { PublicConfigStore } from '../../core/config/public-config.store';
import type { ThemeConfig } from '../../core/api/public-config.api';
import { provideI18nTesting } from '../../core/i18n/testing';
import { ThemeSwitcherComponent } from './theme-switcher.component';

const CFG: ThemeConfig = {
  slots: { dia: 'marquesina', noche: 'pulso' },
  defaultFranja: 'noche',
  allowVisitorSwitch: true,
};

describe('ThemeSwitcherComponent', () => {
  let fixture: ComponentFixture<ThemeSwitcherComponent>;
  let cfg: WritableSignal<ThemeConfig>;

  function setup(themeCfg: ThemeConfig = CFG): void {
    cfg = signal<ThemeConfig>(themeCfg);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://test.local/api/v1' },
        { provide: PublicConfigStore, useValue: { theme: cfg.asReadonly() } },
        ...provideI18nTesting(),
      ],
    });
    fixture = TestBed.createComponent(ThemeSwitcherComponent);
    fixture.detectChanges();
  }

  const q = (sel: string) => (fixture.nativeElement as HTMLElement).querySelector(sel);

  it('muestra el botón cuando el switch está habilitado', () => {
    setup();
    expect(q('[data-testid="theme-toggle"]')).not.toBeNull();
  });

  it('OCULTA el botón cuando el admin deshabilita el switch', () => {
    setup({ ...CFG, allowVisitorSwitch: false });
    expect(q('[data-testid="theme-toggle"]')).toBeNull();
  });

  it('visitante: al alternar NO persiste en el perfil (sin PATCH /users/me)', () => {
    setup();
    const http = TestBed.inject(HttpTestingController);
    (q('[data-testid="theme-toggle"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    http.expectNone((r) => r.url.endsWith('/users/me') && r.method === 'PATCH');
    http.verify();
  });

  it('usuario logueado: al alternar persiste la franja en el perfil (PATCH /users/me)', () => {
    setup();
    const http = TestBed.inject(HttpTestingController);
    const session = TestBed.inject(SessionStore);
    session.setUser({ id: 'u1', email: 'x@y.z', roles: ['buyer'], language: 'es' } as never);
    fixture.detectChanges();
    (q('[data-testid="theme-toggle"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const req = http.expectOne((r) => r.url.endsWith('/users/me') && r.method === 'PATCH');
    expect(req.request.body.themePref).toBe('dia'); // arranca en noche → alterna a día
    req.flush({ id: 'u1', email: 'x@y.z', roles: ['buyer'], language: 'es', themePref: 'dia' });
    http.verify();
  });
});
