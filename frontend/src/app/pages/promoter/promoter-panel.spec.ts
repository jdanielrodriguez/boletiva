import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CategoriesApi } from '../../core/api/categories.api';
import { InvitationsApi } from '../../core/api/invitations.api';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { PromoterPanel } from './promoter-panel';

const EVENTS = [
  { id: 'e1', name: 'Fiesta', slug: 'fiesta', status: 'draft', startsAt: '2028-08-15T02:00:00.000Z' },
];

interface Ov {
  events?: Record<string, unknown>;
  invitations?: Record<string, unknown>;
}

describe('PromoterPanel (F4)', () => {
  let fixture: ComponentFixture<PromoterPanel>;
  let el: HTMLElement;

  async function setup(o: Ov = {}) {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: PromoterEventsApi,
          useValue: {
            mine: () => of(EVENTS),
            create: () => of(EVENTS[0]),
            publish: () => of(EVENTS[0]),
            cancel: () => of(EVENTS[0]),
            generateBanner: () => of({ url: 'http://x/banner.svg' }),
            localities: () => of([]),
            addLocality: () => of({}),
            ...o.events,
          } as unknown as PromoterEventsApi,
        },
        { provide: CategoriesApi, useValue: { list: () => of([{ id: 'c1', name: 'Conciertos', slug: 'c' }]) } },
        {
          provide: InvitationsApi,
          useValue: {
            list: () => of([]),
            create: () => of({ invitations: [{ id: 'i1', email: 'a@b.com', url: 'http://x/registro?token=t', token: 't', expiresAt: '' }] }),
            revoke: () => of({ id: 'i1', status: 'revoked' }),
            ...o.invitations,
          } as unknown as InvitationsApi,
        },
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
    const c = fixture.componentInstance as unknown as Record<string, { set?: (v: unknown) => void } & Record<string, { set: (v: unknown) => void }>>;
    const parts = path.split('.');
    const target = parts.length === 1 ? c[parts[0]] : c[parts[0]][parts[1]];
    (target as { set: (v: unknown) => void }).set(value);
  };

  it('lista mis eventos', async () => {
    await setup();
    expect(el.querySelector('[data-testid="events-list"]')?.textContent).toContain('Fiesta');
  });

  it('crear evento sin fechas → error, no llama create', async () => {
    const create = jasmine.createSpy('create').and.returnValue(of(EVENTS[0]));
    await setup({ events: { mine: () => of(EVENTS), create, localities: () => of([]) } });
    setSig('form.name', 'Nuevo');
    click('ev-create');
    expect(create).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="panel-error"]')).not.toBeNull();
  });

  it('crear evento válido llama create', async () => {
    const create = jasmine.createSpy('create').and.returnValue(of(EVENTS[0]));
    await setup({ events: { mine: () => of(EVENTS), create, localities: () => of([]) } });
    setSig('form.name', 'Nuevo');
    setSig('form.startsAt', '2028-08-15T20:00');
    setSig('form.endsAt', '2028-08-15T23:00');
    click('ev-create');
    expect(create).toHaveBeenCalled();
  });

  it('publicar un evento draft llama publish', async () => {
    const publish = jasmine.createSpy('publish').and.returnValue(of(EVENTS[0]));
    await setup({ events: { mine: () => of(EVENTS), publish, localities: () => of([]) } });
    click('ev-publish');
    expect(publish).toHaveBeenCalledWith('e1');
  });

  it('generar banner muestra la imagen', async () => {
    await setup();
    click('ev-banner');
    expect(el.querySelector('.pe-banner')?.getAttribute('src')).toContain('banner.svg');
  });

  it('invitar parsea correos, llama create y muestra los enlaces', async () => {
    const create = jasmine.createSpy('create').and.returnValue(
      of({ invitations: [{ id: 'i1', email: 'a@b.com', url: 'http://x/registro?token=t', token: 't', expiresAt: '' }] }),
    );
    await setup({ invitations: { list: () => of([]), create } });
    click('tab-invitaciones');
    setSig('emailsText', 'a@b.com, c@d.com');
    click('inv-submit');
    expect(create).toHaveBeenCalledWith(['a@b.com', 'c@d.com']);
    const url = el.querySelector('[data-testid="inv-created"] input') as HTMLInputElement;
    expect(url.value).toContain('registro?token=t');
  });
});
