import { Component, SecurityContext, computed, inject } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, catchError, debounceTime, distinctUntilChanged, map, of, startWith, switchMap, tap } from 'rxjs';
import { KbApi, KbCategory, KbPublicArticle } from '../../core/api/kb.api';
import { SeoService } from '../../core/seo/seo.service';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { LoadingComponent } from '../../shared/ui/loading.component';
import { SearchFieldComponent } from '../../shared/ui/search-field.component';

interface FaqResult {
  ok: boolean;
  items: KbPublicArticle[];
}

/** Convierte HTML a texto plano (para el JSON-LD FAQPage; el navegador/servidor). */
function toPlain(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

const CATEGORIES: { slug: KbCategory; key: string }[] = [
  { slug: 'account', key: 'faq.cat.account' },
  { slug: 'payments_settlement', key: 'faq.cat.payments_settlement' },
  { slug: 'billing', key: 'faq.cat.billing' },
  { slug: 'event', key: 'faq.cat.event' },
  { slug: 'technical', key: 'faq.cat.technical' },
  { slug: 'other', key: 'faq.cat.other' },
];

/**
 * FAQ público (T6). SSR + SEO + JSON-LD FAQPage → indexable en buscadores como rich
 * result. Contenido anónimo y cacheable en el edge. Filtros (categoría/búsqueda) en la
 * query string. La respuesta se pinta con [innerHTML] (Angular sanea en el render).
 */
@Component({
  selector: 'app-faq',
  imports: [TranslatePipe, EmptyStateComponent, LoadingComponent, SearchFieldComponent],
  templateUrl: './faq.page.html',
})
export class FaqPage {
  private readonly kb = inject(KbApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly seo = inject(SeoService);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly categories = CATEGORIES;

  /** Búsqueda EN VIVO: cada tecla (con debounce) actualiza `?q=` sin ensuciar el historial
   *  → el stream reactivo re-consulta. Enter dispara inmediato (submitSearch). */
  private readonly liveSearch$ = new Subject<string>();

  constructor() {
    this.liveSearch$
      .pipe(debounceTime(250), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((term) => this.submitSearch(term, true));
  }

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly activeCategory = computed(() => this.params().get('category') ?? '');
  protected readonly search = computed(() => this.params().get('q') ?? '');

  private readonly result = toSignal(
    this.route.queryParamMap.pipe(
      switchMap((pm) =>
        this.kb
          .listPublic({
            category: (pm.get('category') as KbCategory) || undefined,
            q: pm.get('q') ?? undefined,
          })
          .pipe(
            tap((items) => this.applySeo(items, pm.get('category'), pm.get('q'))),
            map((items): FaqResult => ({ ok: true, items })),
            catchError(() => of<FaqResult>({ ok: false, items: [] })),
            startWith(null as FaqResult | null),
          ),
      ),
    ),
    { initialValue: null as FaqResult | null },
  );

  protected readonly articles = computed(() => this.result()?.items ?? []);
  protected readonly loading = computed(() => this.result() === null);
  protected readonly errored = computed(() => {
    const r = this.result();
    return r !== null && !r.ok;
  });
  protected readonly hasFilter = computed(() => !!this.activeCategory() || !!this.search());

  /** HTML saneado para pintar con [innerHTML]. */
  protected safe(html: string): SafeHtml {
    return this.sanitizer.sanitize(SecurityContext.HTML, html) ?? '';
  }

  protected selectCategory(slug: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { category: slug || null },
      queryParamsHandling: 'merge',
    });
  }

  /** Cada tecla del campo → búsqueda en vivo con debounce. */
  protected onSearchInput(term: string): void {
    this.liveSearch$.next(term);
  }

  protected submitSearch(term: string, replaceUrl = false): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q: term.trim() || null },
      queryParamsHandling: 'merge',
      replaceUrl,
    });
  }

  private applySeo(items: KbPublicArticle[], category: string | null, q: string | null): void {
    const suffix = category ? ` · ${category}` : q ? ` · "${q}"` : '';
    // JSON-LD FAQPage: solo cuando NO hay filtro (la vista completa es el rich result).
    const jsonLd =
      !category && !q && items.length
        ? {
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: items.slice(0, 50).map((a) => ({
              '@type': 'Question',
              name: a.question,
              acceptedAnswer: { '@type': 'Answer', text: toPlain(a.answerHtml) },
            })),
          }
        : undefined;
    this.seo.apply({
      title: `Preguntas frecuentes${suffix} — Boletiva`,
      description: 'Resuelve tus dudas sobre compra de boletos, pagos, transferencias y reembolsos en Boletiva.',
      path: '/faq',
      type: 'website',
      jsonLd,
    });
  }
}
