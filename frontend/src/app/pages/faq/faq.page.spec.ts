import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Observable, of } from 'rxjs';
import { provideI18nTesting } from '../../core/i18n/testing';
import { SITE_URL } from '../../core/config/api.tokens';
import { KbApi, KbPublicArticle } from '../../core/api/kb.api';
import { FaqPage } from './faq.page';

const ARTICLES: KbPublicArticle[] = [
  { slug: 'a1', question: '¿Cómo compro?', answerHtml: '<p>Así <strong>compras</strong></p>', category: 'account', tags: [] },
  { slug: 'a2', question: '¿Pagos?', answerHtml: '<p>Tarjeta</p><script>alert(1)</script>', category: 'payments_settlement', tags: [] },
];

function setup(list: () => Observable<KbPublicArticle[]>, params: Record<string, string> = {}) {
  TestBed.configureTestingModule({
    providers: [
      ...provideI18nTesting(),
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: KbApi, useValue: { listPublic: list } },
      { provide: SITE_URL, useValue: 'http://localhost:4200' },
      {
        provide: ActivatedRoute,
        useValue: {
          queryParamMap: of(convertToParamMap(params)),
          snapshot: { queryParamMap: convertToParamMap(params) },
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(FaqPage);
  fixture.detectChanges();
  return fixture;
}

describe('FaqPage (T6 · FAQ público)', () => {
  it('lista las preguntas publicadas', () => {
    const fixture = setup(() => of(ARTICLES));
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('[data-testid="faq-list"] .faq-item').length).toBe(2);
    expect(el.textContent).toContain('¿Cómo compro?');
  });

  it('renderiza la respuesta con formato pero SANEADA (sin <script>)', () => {
    const fixture = setup(() => of(ARTICLES));
    const el = fixture.nativeElement as HTMLElement;
    const html = el.querySelector('.faq-answer')?.innerHTML ?? '';
    expect(html).toContain('<strong>');
    expect(el.innerHTML).not.toContain('<script>');
  });

  it('inyecta JSON-LD FAQPage cuando no hay filtros', () => {
    setup(() => of(ARTICLES));
    const ld = document.querySelector('script[type="application/ld+json"]');
    expect(ld?.textContent).toContain('"@type":"FAQPage"');
    expect(ld?.textContent).toContain('¿Cómo compro?');
  });

  it('estado vacío cuando no hay artículos', () => {
    const fixture = setup(() => of([]));
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="faq-empty"]')).not.toBeNull();
  });

  it('estado de error si la carga falla', () => {
    const fixture = setup(
      () =>
        new Observable<KbPublicArticle[]>((s) => {
          s.error(new Error('boom'));
        }),
    );
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="faq-error"]')).not.toBeNull();
  });
});
