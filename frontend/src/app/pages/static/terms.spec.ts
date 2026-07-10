import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { SITE_URL } from '../../core/config/api.tokens';
import { I18nService } from '../../core/i18n/i18n.service';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
import { Terms } from './terms';

describe('Terms (v3.6 — contenido legal ES/EN)', () => {
  let fixture: ComponentFixture<Terms>;
  let el: HTMLElement;
  let i18n: I18nService;

  async function setup() {
    TestBed.configureTestingModule({
      providers: [
        ...provideI18nTesting(),
        provideZonelessChangeDetection(),
        { provide: SITE_URL, useValue: 'http://localhost:4200' },
      ],
    });
    initI18nTesting();
    fixture = TestBed.createComponent(Terms);
    i18n = TestBed.inject(I18nService);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  it('renderiza el documento en español con todas las secciones y la fecha', async () => {
    await setup();
    expect(el.querySelector('h1')?.textContent).toContain('Términos y Condiciones');
    expect(el.querySelector('.legal-updated')?.textContent).toContain('Última actualización');
    // 16 secciones legales numeradas.
    expect(el.querySelectorAll('.legal-section').length).toBe(16);
    // El índice enlaza cada sección por ancla.
    expect(el.querySelectorAll('.legal-toc a').length).toBe(16);
    expect(el.textContent).toContain('Guatemala');
    expect(el.textContent).toContain('GTQ');
  });

  it('fija el título de la pestaña (SEO) en español', async () => {
    await setup();
    expect(TestBed.inject(Title).getTitle()).toBe('Términos y Condiciones — Pasa Eventos');
  });

  it('al cambiar a inglés re-renderiza el contenido y el título', async () => {
    await setup();
    i18n.use('en');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('h1')?.textContent).toContain('Terms and Conditions');
    expect(el.querySelectorAll('.legal-section').length).toBe(16);
    expect(TestBed.inject(Title).getTitle()).toBe('Terms and Conditions — Pasa Eventos');
  });
});
