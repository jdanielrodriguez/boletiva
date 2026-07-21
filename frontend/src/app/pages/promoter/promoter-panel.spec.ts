import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { CategoriesApi } from '../../core/api/categories.api';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { PromotersApi } from '../../core/api/promoters.api';
import { PublicConfigStore } from '../../core/config/public-config.store';
import { SessionStore } from '../../core/auth/session.store';
import { UsersApi } from '../../core/api/users.api';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
import { I18nService } from '../../core/i18n/i18n.service';
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
        { provide: SessionStore, useValue: { user: () => null } },
        { provide: UsersApi, useValue: { markTourSeen: () => of({}) } },
        { provide: CategoriesApi, useValue: { list: () => of([]) } },
        {
          provide: PromotersApi,
          useValue: {
            myStatus: () => of({ promoterTier: 'free', premiumBenefitsActive: true, premiumTrialEndsAt: null }),
          } as unknown as PromotersApi,
        },
        {
          provide: PublicConfigStore,
          useValue: {
            load: () => undefined,
            premium: () => ({ enabled: false, trialEnabled: false, trialDays: 7 }),
            tourEnabled: () => false,
            chatEnabled: () => false,
            canFeatureEvents: () => true,
          },
        },
        provideZonelessChangeDetection(),
        ...provideI18nTesting(),
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
      ],
    });
    initI18nTesting();
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
  it('lista mis eventos en un grid de cards', async () => {
    await setup();
    const cards = el.querySelectorAll('[data-testid="ev-card"]');
    expect(cards.length).toBe(2);
    expect(el.querySelector('[data-testid="events-grid"]')?.textContent).toContain('Fiesta');
  });

  it('la búsqueda filtra los eventos por nombre', async () => {
    await setup();
    (fixture.componentInstance as unknown as { search: { set: (v: string) => void } }).search.set('fiesta');
    (fixture.componentInstance as unknown as { onFilterChange: () => void }).onFilterChange();
    fixture.detectChanges();
    const cards = el.querySelectorAll('[data-testid="ev-card"]');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Fiesta');
  });

  it('el filtro por grupo de estado limita el grid (W8): default oculta suspendidos', async () => {
    await setup({
      mine: () =>
        of([
          { id: 'e1', name: 'Fiesta', slug: 'fiesta', status: 'draft', startsAt: '2028-08-15T02:00:00.000Z', endsAt: '2028-08-15T05:00:00.000Z', _count: { localities: 0 } },
          { id: 'e3', name: 'Susp', slug: 'susp', status: 'suspended', startsAt: '2028-10-01T02:00:00.000Z', endsAt: '2028-10-01T05:00:00.000Z', _count: { localities: 2 } },
        ]),
    });
    // Default 'active' → el suspendido queda oculto.
    expect(el.querySelectorAll('[data-testid="ev-card"]').length).toBe(1);
    expect(el.querySelector('[data-testid="events-grid"]')?.textContent).toContain('Fiesta');
    // Cambiar el filtro a 'suspended' muestra solo el suspendido.
    (fixture.componentInstance as unknown as { filterGroup: { set: (v: string) => void } }).filterGroup.set('suspended');
    (fixture.componentInstance as unknown as { onFilterChange: () => void }).onFilterChange();
    fixture.detectChanges();
    const cards = el.querySelectorAll('[data-testid="ev-card"]');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Susp');
  });

  it('búsqueda sin coincidencias muestra el estado vacío', async () => {
    await setup();
    (fixture.componentInstance as unknown as { search: { set: (v: string) => void } }).search.set('zzz');
    (fixture.componentInstance as unknown as { onFilterChange: () => void }).onFilterChange();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="events-no-match"]')).not.toBeNull();
  });

  it('"Nuevo evento" navega a la vista de creación en blanco (no hay mini-form)', async () => {
    await setup();
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    // Ya no existe el mini-form inline (create-form) en el panel.
    expect(el.querySelector('[data-testid="create-form"]')).toBeNull();
    click('toggle-create');
    expect(nav).toHaveBeenCalledWith(['/promotor/eventos/nuevo']);
  });

  it('publicar un evento draft pide confirmación y luego llama publish', async () => {
    const publish = jasmine.createSpy('publish').and.returnValue(of(EVENTS[0]));
    await setup({ publish });
    click('ev-publish');
    // No publica al primer click: aparece el modal de confirmación.
    expect(publish).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="confirm-dialog"]')).not.toBeNull();
    click('confirm-accept');
    expect(publish).toHaveBeenCalledWith('e1');
  });

  it('eliminar un evento draft pide confirmación y luego llama remove', async () => {
    const remove = jasmine.createSpy('remove').and.returnValue(of(undefined));
    await setup({ remove });
    click('ev-delete');
    // No elimina al primer click: aparece el modal de confirmación.
    expect(remove).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="confirm-dialog"]')).not.toBeNull();
    click('confirm-accept');
    expect(remove).toHaveBeenCalledWith('e1');
  });

  it('cancelar la confirmación NO elimina el evento', async () => {
    const remove = jasmine.createSpy('remove').and.returnValue(of(undefined));
    await setup({ remove });
    click('ev-delete');
    click('confirm-cancel');
    expect(remove).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="confirm-dialog"]')).toBeNull();
  });

  it('cancelar un evento publicado pide confirmación y luego llama cancel', async () => {
    const cancel = jasmine.createSpy('cancel').and.returnValue(of(EVENTS[1]));
    await setup({ cancel });
    click('ev-cancel');
    expect(cancel).not.toHaveBeenCalled();
    click('confirm-accept');
    expect(cancel).toHaveBeenCalledWith('e2');
  });

  it('suspender un evento publicado pide confirmación y luego llama suspend (v3.7)', async () => {
    const suspend = jasmine.createSpy('suspend').and.returnValue(of({ ...EVENTS[1], status: 'suspended' }));
    await setup({ suspend });
    click('ev-suspend');
    expect(suspend).not.toHaveBeenCalled();
    click('confirm-accept');
    expect(suspend).toHaveBeenCalledWith('e2');
  });

  it('un evento suspendido ofrece Publicar (re-publicar) y Cancelar (v3.7)', async () => {
    await setup({
      mine: () =>
        of([{ id: 'e3', name: 'Susp', slug: 'susp', status: 'suspended', startsAt: '2028-10-01T02:00:00.000Z', endsAt: '2028-10-01T05:00:00.000Z', _count: { localities: 2 } }]),
    });
    // El default 'Futuros' oculta suspendidos; se cambia el filtro para verlo (W8).
    (fixture.componentInstance as unknown as { filterGroup: { set: (v: string) => void } }).filterGroup.set('suspended');
    (fixture.componentInstance as unknown as { onFilterChange: () => void }).onFilterChange();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="ev-publish"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="ev-cancel"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="ev-suspend"]')).toBeNull();
  });

  it('muestra estado vacío cuando no hay eventos', async () => {
    await setup({ mine: () => of([]) });
    expect(el.querySelector('[data-testid="events-empty"]')).not.toBeNull();
  });

  // --- i18n: cambiar el idioma traduce los textos ---
  it('traduce los textos al inglés al cambiar el idioma', async () => {
    await setup();
    TestBed.inject(I18nService).use('en');
    fixture.detectChanges();
    // El título "Mis eventos" pasa a "My events".
    expect(el.querySelector('h1')?.textContent).toContain('My events');
  });

  // --- Premium (B1): destacar propio + chip de plan ---
  it('destacar: con beneficios activos, el evento publicado ofrece el switch y llama a promote', async () => {
    const promote = jasmine.createSpy('promote').and.returnValue(of(EVENTS[1]));
    await setup({ promote });
    const sw = el.querySelector('[data-testid="ev-promote-e2"]') as HTMLButtonElement; // e2 = published
    expect(sw).not.toBeNull(); // premium off (stub) → beneficios para todos → switch visible
    sw.click();
    fixture.detectChanges();
    expect(promote).toHaveBeenCalledWith('e2', true);
  });

  it('chip de plan: con premium APAGADO no se muestra (sin distinción)', async () => {
    await setup();
    expect(el.querySelector('[data-testid="tier-chip"]')).toBeNull();
  });
});
