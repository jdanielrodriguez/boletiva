import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SessionStore } from '../../core/auth/session.store';
import { API_BASE_URL } from '../../core/config/api.tokens';
import { I18nService } from '../../core/i18n/i18n.service';
import { provideI18nTesting } from '../../core/i18n/testing';
import { LangSwitcherComponent } from './lang-switcher.component';

describe('LangSwitcherComponent', () => {
  let fixture: ComponentFixture<LangSwitcherComponent>;
  let i18n: I18nService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://test.local/api/v1' },
        ...provideI18nTesting(),
      ],
    });
    i18n = TestBed.inject(I18nService);
    i18n.init();
    fixture = TestBed.createComponent(LangSwitcherComponent);
    fixture.detectChanges();
  });

  it('muestra ambas banderas', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="lang-es"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="lang-en"]')).not.toBeNull();
  });

  it('marca español como activo por defecto', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="lang-es"]')?.classList.contains('active')).toBe(true);
    expect(el.querySelector('[data-testid="lang-en"]')?.classList.contains('active')).toBe(false);
  });

  it('click en la bandera de EEUU cambia el idioma a inglés', () => {
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('[data-testid="lang-en"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(i18n.lang()).toBe('en');
    expect(el.querySelector('[data-testid="lang-en"]')?.classList.contains('active')).toBe(true);
    expect(el.querySelector('[data-testid="lang-es"]')?.classList.contains('active')).toBe(false);
  });

  it('vuelve a español al hacer click en la bandera de Guatemala', () => {
    const el = fixture.nativeElement as HTMLElement;
    i18n.use('en');
    fixture.detectChanges();
    (el.querySelector('[data-testid="lang-es"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(i18n.lang()).toBe('es');
  });

  it('con sesión iniciada persiste el idioma en BD (PATCH /users/me)', () => {
    const http = TestBed.inject(HttpTestingController);
    const session = TestBed.inject(SessionStore);
    session.setUser({ id: 'u1', email: 'x@y.z', roles: ['buyer'], language: 'es' } as never);
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('[data-testid="lang-en"]') as HTMLButtonElement).click();
    const req = http.expectOne((r) => r.url.endsWith('/users/me') && r.method === 'PATCH');
    expect(req.request.body).toEqual({ language: 'en' });
    req.flush({ id: 'u1', email: 'x@y.z', roles: ['buyer'], language: 'en' });
    http.verify();
  });
});
