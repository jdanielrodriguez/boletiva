import { Component, computed, effect, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { SeoService } from '../../core/seo/seo.service';

/** Una sección del documento legal (encabezado + párrafos + viñetas opcionales). */
interface TermsSection {
  id: string;
  heading: string;
  paragraphs: string[];
  bullets?: string[];
}

/** Contenido completo de la página de Términos y Condiciones (por idioma). */
interface TermsContent {
  metaTitle: string;
  metaDescription: string;
  title: string;
  lastUpdated: string;
  intro: string;
  tocTitle: string;
  sections: TermsSection[];
}

/**
 * Términos y Condiciones. El contenido legal completo vive en el namespace i18n
 * `terms` (ES/EN) y se lee reactivamente: el `computed` depende de la señal
 * `i18n.lang()`, así que al cambiar de idioma la página se vuelve a renderizar.
 * SSR-safe: el loader es síncrono, `instant` funciona también en el servidor.
 */
@Component({
  selector: 'app-terms',
  template: `
    <article class="static-page legal-page">
      <header class="legal-head">
        <h1>{{ content().title }}</h1>
        <p class="legal-updated">{{ content().lastUpdated }}</p>
        <p class="legal-intro">{{ content().intro }}</p>
      </header>

      <nav class="legal-toc" [attr.aria-label]="content().tocTitle">
        <h2>{{ content().tocTitle }}</h2>
        <ol>
          @for (s of content().sections; track s.id) {
            <li><a [href]="'#' + s.id">{{ s.heading }}</a></li>
          }
        </ol>
      </nav>

      @for (s of content().sections; track s.id) {
        <section class="legal-section" [id]="s.id">
          <h2>{{ s.heading }}</h2>
          @for (p of s.paragraphs; track $index) {
            <p>{{ p }}</p>
          }
          @if (s.bullets && s.bullets.length) {
            <ul>
              @for (b of s.bullets; track $index) {
                <li>{{ b }}</li>
              }
            </ul>
          }
        </section>
      }
    </article>
  `,
})
export class Terms {
  private readonly translate = inject(TranslateService);
  private readonly i18n = inject(I18nService);
  private readonly seo = inject(SeoService);

  /** Reactivo al idioma: al cambiar `lang()` se relee el diccionario activo. */
  protected readonly content = computed<TermsContent>(() => {
    this.i18n.lang(); // dependencia: reejecuta al cambiar de idioma
    return this.translate.instant('terms') as TermsContent;
  });

  constructor() {
    // SSR + primer render: fija el SEO síncronamente (crawlers). El effect lo
    // mantiene al día si el usuario cambia de idioma en el navegador.
    this.applySeo();
    effect(() => this.applySeo());
  }

  private applySeo(): void {
    const c = this.content();
    this.seo.apply({
      title: c.metaTitle,
      description: c.metaDescription,
      path: '/terminos',
      type: 'article',
    });
  }
}
