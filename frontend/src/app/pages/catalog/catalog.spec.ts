import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { CategoriesApi } from '../../core/api/categories.api';
import { EventsApi } from '../../core/api/events.api';
import { SITE_URL } from '../../core/config/api.tokens';
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

function setup(listPublic: () => Observable<unknown>): ComponentFixture<Catalog> {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: EventsApi, useValue: { listPublic } },
      { provide: CategoriesApi, useValue: { list: () => of(CATS) } },
      { provide: SITE_URL, useValue: 'http://localhost:4200' },
      {
        provide: ActivatedRoute,
        useValue: {
          queryParamMap: of(convertToParamMap({})),
          snapshot: { queryParamMap: convertToParamMap({}) },
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
});
