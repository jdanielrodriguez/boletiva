import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { SITE_URL } from '../config/api.tokens';

const JSONLD_ID = 'pe-jsonld';

export interface SeoData {
  title: string;
  description: string;
  /** Path absoluto del recurso (p.ej. /eventos/mi-evento); se antepone SITE_URL. */
  path: string;
  image?: string | null;
  /** og:type — 'website' para listados, 'article'/'event' para detalle. */
  type?: string;
  /** Si true, agrega noindex (páginas no indexables: 404, resultados privados). */
  noindex?: boolean;
  /** Objeto JSON-LD (schema.org) a inyectar en <head>. */
  jsonLd?: Record<string, unknown>;
}

/**
 * Centraliza título, meta tags (SEO + Open Graph/Twitter), URL canónica y
 * JSON-LD. Funciona en SSR (Title/Meta y manipulación del DOCUMENT se ejecutan
 * también en el servidor), que es donde importa para los crawlers.
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly doc = inject(DOCUMENT);
  private readonly siteUrl = inject(SITE_URL);

  apply(data: SeoData): void {
    const url = this.absolute(data.path);

    this.title.setTitle(data.title);
    this.setTag('description', data.description);
    this.setRobots(data.noindex === true);

    this.setProperty('og:title', data.title);
    this.setProperty('og:description', data.description);
    this.setProperty('og:type', data.type ?? 'website');
    this.setProperty('og:url', url);
    this.setTag('twitter:card', data.image ? 'summary_large_image' : 'summary');
    if (data.image) {
      this.setProperty('og:image', data.image);
    } else {
      this.meta.removeTag("property='og:image'");
    }

    this.setCanonical(url);
    this.setJsonLd(data.jsonLd);
  }

  private absolute(path: string): string {
    const base = this.siteUrl.replace(/\/$/, '');
    return path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  private setTag(name: string, content: string): void {
    this.meta.updateTag({ name, content });
  }

  private setProperty(property: string, content: string): void {
    this.meta.updateTag({ property, content });
  }

  private setRobots(noindex: boolean): void {
    if (noindex) this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    else this.meta.removeTag("name='robots'");
  }

  private setCanonical(url: string): void {
    const head = this.doc.head;
    let link = head.querySelector<HTMLLinkElement>("link[rel='canonical']");
    if (!link) {
      link = this.doc.createElement('link');
      link.setAttribute('rel', 'canonical');
      head.appendChild(link);
    }
    link.setAttribute('href', url);
  }

  private setJsonLd(data?: Record<string, unknown>): void {
    const head = this.doc.head;
    const existing = head.querySelector(`#${JSONLD_ID}`);
    if (existing) existing.remove();
    if (!data) return;
    const script = this.doc.createElement('script');
    script.id = JSONLD_ID;
    script.setAttribute('type', 'application/ld+json');
    // Seguridad (QA): dentro de un <script> el contenido es "raw text" — en SSR NO se
    // escapa. Si un valor (p.ej. el nombre de un evento o la pregunta de un FAQ) contiene
    // `</script>`, cerraría el bloque e inyectaría HTML/JS en TODOS los visitantes. Se
    // escapan `<`,`>`,`&` como \uXXXX (JSON válido) para que ningún dato rompa el bloque.
    script.textContent = JSON.stringify(data)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');
    head.appendChild(script);
  }
}
