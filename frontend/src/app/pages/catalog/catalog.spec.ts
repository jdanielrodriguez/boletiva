import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { I18nService } from '../../core/i18n/i18n.service';
import { provideI18nTesting } from '../../core/i18n/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { CategoriesApi } from '../../core/api/categories.api';
import { EventsApi } from '../../core/api/events.api';
import { SITE_URL } from '../../core/config/api.tokens';
import { PublicConfigStore } from '../../core/config/public-config.store';
import { Catalog } from './catalog';

const EVENT = {
  id: 'e1',
  name: 'Concierto X',
  slug: 'concierto-x',
  startsAt: '2028-08-15T02:00:00.000Z',
  address: 'Estadio',
  category: { id: 'c1', name: 'Conciertos', slug: 'conciertos' },
  media: [],
};
const CATS = [{ id: 'c1', name: 'Conciertos', slug: 'conciertos' }];

function setup(
  listPublic: () => Observable<unknown>,
  params: Record<string, string> = {},
): ComponentFixture<Catalog> {
  TestBed.configureTestingModule({
    providers: [
        ...provideI18nTesting(),
        ...provideI18nTesting(),
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: EventsApi, useValue: { listPublic, promoted: () => of([]) } },
      { provide: CategoriesApi, useValue: { list: () => of(CATS) } },
      { provide: SITE_URL, useValue: 'http://localhost:4200' },
      // Stub del store de config (evita el HTTP de refresh() en el constructor, W2/W10).
      {
        provide: PublicConfigStore,
        useValue: { showHomeCategories: signal(true).asReadonly(), refresh: () => undefined },
      },
      {
        provide: ActivatedRoute,
        useValue: {
          queryParamMap: of(convertToParamMap(params)),
          snapshot: { queryParamMap: convertToParamMap(params) },
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(Catalog);
  fixture.detectChanges();
  return fixture;
}

describe('Catalog', () => {
  it('renderiza el conteo y las cards', () => {
    const fixture = setup(() => of({ items: [EVENT], total: 1, skip: 0, take: 12 }));
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="catalog-count"]')?.textContent).toContain('1');
    expect(el.querySelector('.event-card h2')?.textContent).toContain('Concierto X');
  });

  it('muestra estado vacío sin resultados', () => {
    const fixture = setup(() => of({ items: [], total: 0, skip: 0, take: 12 }));
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="catalog-empty"]')).not.toBeNull();
  });

  it('muestra estado de error si el API falla', () => {
    const fixture = setup(() => throwError(() => new Error('boom')));
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="catalog-error"]')).not.toBeNull();
  });

  it('no muestra el paginador con una sola página', () => {
    const fixture = setup(() => of({ items: [EVENT], total: 1, skip: 0, take: 12 }));
    expect((fixture.nativeElement as HTMLElement).querySelector('.catalog-pager')).toBeNull();
  });

  it('en la página 1 (10 páginas): resalta la 1 y deshabilita primero/anterior', () => {
    const fixture = setup(() => of({ items: [EVENT], total: 120, skip: 0, take: 12 }));
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.catalog-pager')).not.toBeNull();
    expect(el.querySelector('.pager-page.is-current')?.textContent?.trim()).toBe('1');
    const arrows = el.querySelectorAll<HTMLButtonElement>('.pager-arrow');
    expect(arrows[0].disabled).toBe(true); // primera
    expect(arrows[1].disabled).toBe(true); // anterior
    expect(arrows[2].disabled).toBe(false); // siguiente
    expect(arrows[3].disabled).toBe(false); // última
  });

  it('en una página intermedia muestra huecos (…) y la primera/última', () => {
    const fixture = setup(() => of({ items: [EVENT], total: 120, skip: 48, take: 12 }), { page: '5' });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.pager-page.is-current')?.textContent?.trim()).toBe('5');
    expect(el.querySelectorAll('.pager-gap').length).toBe(2);
    const pages = [...el.querySelectorAll('.pager-page')].map((b) => b.textContent?.trim());
    expect(pages).toContain('1');
    expect(pages).toContain('10');
  });

  it('la flecha "última" navega a la última página', () => {
    const fixture = setup(() => of({ items: [EVENT], total: 120, skip: 0, take: 12 }));
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate').and.resolveTo(true);
    const arrows = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.pager-arrow');
    arrows[3].click(); // última
    const args = navSpy.calls.mostRecent().args[1] as { queryParams: Record<string, unknown> };
    expect(args.queryParams['page']).toBe(10);
  });

  it('al elegir una categoría navega con el query param', () => {
    const fixture = setup(() => of({ items: [EVENT], total: 1, skip: 0, take: 12 }));
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate').and.resolveTo(true);
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('.catalog-categories button');
    (buttons[1] as HTMLButtonElement).click();
    expect(navSpy).toHaveBeenCalled();
    const args = navSpy.calls.mostRecent().args[1] as { queryParams: Record<string, unknown> };
    expect(args.queryParams['category']).toBe('conciertos');
  });

  it('traduce el título al cambiar de idioma (i18n runtime)', () => {
    const fixture = setup(() => of({ items: [EVENT], total: 1, skip: 0, take: 12 }));
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Eventos');
    TestBed.inject(I18nService).use('en');
    fixture.detectChanges();
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Events');
  });
});
