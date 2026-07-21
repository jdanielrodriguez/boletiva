import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { provideI18nTesting } from '../../core/i18n/testing';
import { KbApi, KbArticle } from '../../core/api/kb.api';
import { KbAdminPage } from './kb-admin.page';

const ROWS: KbArticle[] = [
  {
    id: 'k1', slug: 's1', question: 'Q1', answerHtml: '<p>a</p>', category: 'account', tags: [],
    locale: 'es', status: 'published', visibility: 'public', sortOrder: 0, viewCount: 0,
    publishedAt: null, updatedAt: '2026-01-01',
  },
  {
    id: 'k2', slug: 's2', question: 'Q2', answerHtml: '<p>b</p>', category: null, tags: [],
    locale: 'es', status: 'draft', visibility: 'internal', sortOrder: 0, viewCount: 0,
    publishedAt: null, updatedAt: '2026-01-01',
  },
];

function setup(api: Partial<Record<keyof KbApi, unknown>>) {
  TestBed.configureTestingModule({
    providers: [
      ...provideI18nTesting(),
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: KbApi, useValue: { adminList: () => of(ROWS), ...api } },
    ],
  });
  const fixture = TestBed.createComponent(KbAdminPage);
  fixture.detectChanges();
  return fixture;
}

describe('KbAdminPage (T6 · gestión KB)', () => {
  it('lista los artículos con su estado y badge interno', () => {
    const fixture = setup({});
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('[data-testid="kb-list"] .kb-row').length).toBe(2);
    expect(el.querySelector('.kb-badge-internal')).not.toBeNull(); // el draft interno
  });

  it('“Nuevo artículo” abre el formulario con el editor', () => {
    const fixture = setup({});
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('[data-testid="kb-new"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="kb-form"]')).not.toBeNull();
    expect(el.querySelector('app-rich-text-editor')).not.toBeNull();
  });

  it('guardar con pregunta/respuesta válidas llama a create', () => {
    let created = false;
    const fixture = setup({ create: () => { created = true; return of(ROWS[0]); } });
    const comp = fixture.componentInstance as unknown as {
      newArticle: () => void;
      editing: () => { question: string; answerHtml: string } | null;
      save: () => void;
    };
    comp.newArticle();
    const m = comp.editing()!;
    m.question = 'Pregunta válida';
    m.answerHtml = '<p>respuesta</p>';
    comp.save();
    expect(created).toBe(true);
  });

  it('no guarda (validación) si la pregunta es muy corta', () => {
    let called = false;
    const fixture = setup({ create: () => { called = true; return of(ROWS[0]); } });
    const comp = fixture.componentInstance as unknown as {
      newArticle: () => void;
      editing: () => { question: string; answerHtml: string } | null;
      save: () => void;
      saveError: () => string;
    };
    comp.newArticle();
    const m = comp.editing()!;
    m.question = 'a';
    m.answerHtml = '<p>x</p>';
    comp.save();
    expect(called).toBe(false);
    expect(comp.saveError()).toBe('kb.validation');
  });
});
