import { DOCUMENT } from '@angular/common';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SITE_URL } from '../config/api.tokens';
import { SeoService } from './seo.service';

describe('SeoService', () => {
  let seo: SeoService;
  let doc: Document;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: SITE_URL, useValue: 'https://pe.test' }],
    });
    seo = TestBed.inject(SeoService);
    doc = TestBed.inject(DOCUMENT);
  });

  afterEach(() => {
    doc.head.querySelector("link[rel='canonical']")?.remove();
    doc.querySelector('#pe-jsonld')?.remove();
  });

  it('fija título, description y canónica absoluta', () => {
    seo.apply({ title: 'Hola', description: 'desc', path: '/eventos/x' });
    expect(doc.title).toBe('Hola');
    expect(doc.querySelector("meta[name='description']")?.getAttribute('content')).toBe('desc');
    expect(doc.querySelector("link[rel='canonical']")?.getAttribute('href')).toBe(
      'https://pe.test/eventos/x',
    );
    expect(doc.querySelector("meta[property='og:url']")?.getAttribute('content')).toBe(
      'https://pe.test/eventos/x',
    );
  });

  it('inyecta y reemplaza el JSON-LD (un solo bloque)', () => {
    seo.apply({ title: 'A', description: 'd', path: '/a', jsonLd: { '@type': 'Event', name: 'A' } });
    let scripts = doc.querySelectorAll('#pe-jsonld');
    expect(scripts.length).toBe(1);
    expect(scripts[0].textContent).toContain('"Event"');

    seo.apply({ title: 'B', description: 'd', path: '/b', jsonLd: { '@type': 'Event', name: 'B' } });
    scripts = doc.querySelectorAll('#pe-jsonld');
    expect(scripts.length).toBe(1);
    expect(scripts[0].textContent).toContain('"B"');
  });

  it('quita el JSON-LD si la página siguiente no lo trae', () => {
    seo.apply({ title: 'A', description: 'd', path: '/a', jsonLd: { x: 1 } });
    seo.apply({ title: 'B', description: 'd', path: '/b' });
    expect(doc.querySelector('#pe-jsonld')).toBeNull();
  });

  it('agrega robots noindex cuando se pide', () => {
    seo.apply({ title: '404', description: 'no', path: '/x', noindex: true });
    expect(doc.querySelector("meta[name='robots']")?.getAttribute('content')).toContain('noindex');
  });

  it('sin imagen usa twitter summary y no deja og:image', () => {
    seo.apply({ title: 'A', description: 'd', path: '/a', image: 'https://img/x.png' });
    expect(doc.querySelector("meta[property='og:image']")?.getAttribute('content')).toBe(
      'https://img/x.png',
    );
    seo.apply({ title: 'B', description: 'd', path: '/b' });
    expect(doc.querySelector("meta[property='og:image']")).toBeNull();
    expect(doc.querySelector("meta[name='twitter:card']")?.getAttribute('content')).toBe('summary');
  });
});
