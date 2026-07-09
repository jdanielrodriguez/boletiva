import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CategoriesApi } from '../../core/api/categories.api';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { PromoterPanel } from './promoter-panel';

const EVENTS = [
  { id: 'e1', name: 'Fiesta', slug: 'fiesta', status: 'draft', startsAt: '2028-08-15T02:00:00.000Z', _count: { localities: 0 } },
  { id: 'e2', name: 'Show', slug: 'show', status: 'published', startsAt: '2028-09-15T02:00:00.000Z', _count: { localities: 1 } },
];

describe('PromoterPanel (v3 grid)', () => {
  let fixture: ComponentFixture<PromoterPanel>;
  let el: HTMLElement;

  async function setup(events: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: PromoterEventsApi,
          useValue: {
            mine: () => of(EVENTS),
            create: () => of(EVENTS[0]),
            publish: () => of(EVENTS[0]),
            cancel: () => of(EVENTS[1]),
            remove: () => of(undefined),
            ...events,
          } as unknown as PromoterEventsApi,
        },
        { provide: CategoriesApi, useValue: { list: () => of([{ id: 'c1', name: 'Conciertos', slug: 'c' }]) } },
      ],
    });
    fixture = TestBed.createComponent(PromoterPanel);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const click = (id: string) => {
    (el.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement).click();
    fixture.detectChanges();
  };
  const setSig = (path: string, value: unknown) => {
    const c = fixture.componentInstance as unknown as Record<string, Record<string, { set: (v: unknown) => void }>>;
    const parts = path.split('.');
    (c[parts[0]][parts[1]] as { set: (v: unknown) => void }).set(value);
  };

  it('lista mis eventos en un grid de cards', async () => {
    await setup();
    const cards = el.querySelectorAll('[data-testid="ev-card"]');
    expect(cards.length).toBe(2);
    expect(el.querySelector('[data-testid="events-grid"]')?.textContent).toContain('Fiesta');
  });

  it('crear evento sin fechas no llama create', async () => {
    const create = jasmine.createSpy('create').and.returnValue(of(EVENTS[0]));
    await setup({ create });
    click('toggle-create');
    setSig('form.name', 'Nuevo');
    click('ev-create');
    expect(create).not.toHaveBeenCalled();
  });

  it('crear evento válido llama create', async () => {
    const create = jasmine.createSpy('create').and.returnValue(of(EVENTS[0]));
    await setup({ create });
    click('toggle-create');
    setSig('form.name', 'Nuevo');
    setSig('form.startsAt', '2028-08-15T20:00');
    setSig('form.endsAt', '2028-08-15T23:00');
    click('ev-create');
    expect(create).toHaveBeenCalled();
  });

  it('publicar un evento draft llama publish', async () => {
    const publish = jasmine.createSpy('publish').and.returnValue(of(EVENTS[0]));
    await setup({ publish });
    click('ev-publish');
    expect(publish).toHaveBeenCalledWith('e1');
  });

  it('eliminar un evento draft llama remove', async () => {
    const remove = jasmine.createSpy('remove').and.returnValue(of(undefined));
    await setup({ remove });
    click('ev-delete');
    expect(remove).toHaveBeenCalledWith('e1');
  });

  it('cancelar un evento publicado llama cancel', async () => {
    const cancel = jasmine.createSpy('cancel').and.returnValue(of(EVENTS[1]));
    await setup({ cancel });
    click('ev-cancel');
    expect(cancel).toHaveBeenCalledWith('e2');
  });

  it('muestra estado vacío cuando no hay eventos', async () => {
    await setup({ mine: () => of([]) });
    expect(el.querySelector('[data-testid="events-empty"]')).not.toBeNull();
  });
});
