import { DOCUMENT } from '@angular/common';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { EventsApi } from '../../core/api/events.api';
import { SITE_URL } from '../../core/config/api.tokens';
import { EventDetail } from './event-detail';

const EVENT = {
  id: 'e1',
  name: 'Concierto X',
  slug: 'concierto-x',
  description: 'Una gran noche',
  address: 'Estadio Nacional',
  lat: 14.6,
  lng: -90.5,
  startsAt: '2028-08-15T02:00:00.000Z',
  endsAt: '2028-08-15T05:00:00.000Z',
  status: 'published',
  category: { id: 'c1', name: 'Conciertos', slug: 'conciertos' },
  media: [{ id: 'm1', kind: 'cover', key: 'k', position: 0, url: 'https://img.test/cover.jpg' }],
  localities: [{ id: 'l1', name: 'General' }],
};

function setup(slug: string, getBySlug: () => Observable<unknown>): ComponentFixture<EventDetail> {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      {
        provide: EventsApi,
        useValue: {
          getBySlug,
          availability: () =>
            of({
              seatMap: null,
              localities: [
                {
                  id: 'ga',
                  name: 'General',
                  slug: 'general',
                  kind: 'general',
                  capacity: 100,
                  available: 50,
                  price: { currency: 'GTQ', net: '100.00', serviceFee: '16.48', iva: '13.20', total: '129.68' },
                },
              ],
              seats: [],
            }),
        },
      },
      { provide: SITE_URL, useValue: 'http://localhost:4200' },
      {
        provide: ActivatedRoute,
        useValue: { paramMap: of(convertToParamMap({ slug })) },
      },
    ],
  });
  const fixture = TestBed.createComponent(EventDetail);
  fixture.detectChanges();
  return fixture;
}

describe('EventDetail', () => {
  afterEach(() => {
    const doc = TestBed.inject(DOCUMENT);
    doc.querySelector('#pe-jsonld')?.remove();
    doc.querySelector("meta[name='robots']")?.remove();
  });

  it('renderiza el evento e inyecta JSON-LD schema.org/Event', () => {
    const fixture = setup('concierto-x', () => of(EVENT));
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Concierto X');
    expect(el.querySelector('[data-testid="locality-row"]')?.textContent).toContain('General');

    const ld = TestBed.inject(DOCUMENT).querySelector('#pe-jsonld');
    expect(ld).not.toBeNull();
    const parsed = JSON.parse(ld!.textContent!);
    expect(parsed['@type']).toBe('Event');
    expect(parsed.name).toBe('Concierto X');
    expect(parsed.startDate).toBe(EVENT.startsAt);
    expect(parsed.location['@type']).toBe('Place');

    const ogImage = TestBed.inject(DOCUMENT).querySelector("meta[property='og:image']");
    expect(ogImage?.getAttribute('content')).toBe('https://img.test/cover.jpg');
    expect(el.querySelector('img.event-cover')?.getAttribute('src')).toBe('https://img.test/cover.jpg');
  });

  it('muestra 404 y marca noindex si el slug no existe', () => {
    const fixture = setup('nope', () => throwError(() => new Error('404')));
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="event-notfound"]')).not.toBeNull();
    const robots = TestBed.inject(DOCUMENT).querySelector("meta[name='robots']");
    expect(robots?.getAttribute('content')).toContain('noindex');
  });
});
