import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, of, switchMap, tap } from 'rxjs';
import { CategoriesApi } from '../../core/api/categories.api';
import { EventsApi } from '../../core/api/events.api';
import type { PublicEventListDto } from '../../core/api/types';
import { SeoService } from '../../core/seo/seo.service';
import { HeroSlider, SlideItem } from '../../shared/hero-slider/hero-slider.component';

const PAGE_SIZE = 12;

/**
 * Catálogo público de eventos. SSR + SEO: se renderiza en el servidor con los
 * datos ya resueltos y es cacheable en el edge (contenido anónimo). Los filtros
 * (categoría/búsqueda/página) viven en la query string → URLs compartibles e
 * indexables; cambiarlos re-consulta el API.
 */
@Component({
  selector: 'app-catalog',
  imports: [RouterLink, DatePipe, HeroSlider],
  templateUrl: './catalog.html',
})
export class Catalog {
  private readonly eventsApi = inject(EventsApi);
  private readonly categoriesApi = inject(CategoriesApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly seo = inject(SeoService);

  protected readonly pageSize = PAGE_SIZE;

  protected readonly categories = toSignal(
    this.categoriesApi.list().pipe(catchError(() => of([]))),
    { initialValue: [] },
  );

  private readonly promoted = toSignal(
    this.eventsApi.promoted().pipe(catchError(() => of([]))),
    { initialValue: [] },
  );

  /** Slides del hero: eventos destacados mapeados (imagen firmada + categoría). */
  protected readonly slides = computed<SlideItem[]>(() =>
    this.promoted().map((e) => ({
      slug: e.slug,
      name: e.name,
      imageUrl: e.media[0]?.url ?? null,
      categoryName: e.category?.name ?? null,
    })),
  );

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  protected readonly activeCategory = computed(() => this.params().get('category') ?? '');
  protected readonly search = computed(() => this.params().get('search') ?? '');
  protected readonly page = computed(() => Math.max(1, Number(this.params().get('page')) || 1));

  /** El hero solo se muestra en el inicio (sin filtros de categoría/búsqueda). */
  protected readonly showHero = computed(() => !this.activeCategory() && !this.search());

  private readonly result = toSignal(
    this.route.queryParamMap.pipe(
      tap((pm) => this.applySeo(pm.get('category'), pm.get('search'))),
      switchMap((pm) => {
        const page = Math.max(1, Number(pm.get('page')) || 1);
        return this.eventsApi
          .listPublic({
            category: pm.get('category') ?? undefined,
            search: pm.get('search') ?? undefined,
            skip: (page - 1) * PAGE_SIZE,
            take: PAGE_SIZE,
          })
          .pipe(catchError(() => of(null)));
      }),
    ),
    { initialValue: null as PublicEventListDto | null },
  );

  protected readonly events = computed(() => this.result()?.items ?? []);
  protected readonly total = computed(() => this.result()?.total ?? 0);
  protected readonly loaded = computed(() => this.result() !== null);
  protected readonly hasNext = computed(() => this.page() * PAGE_SIZE < this.total());
  protected readonly hasPrev = computed(() => this.page() > 1);

  protected selectCategory(slug: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { category: slug || null, page: null },
      queryParamsHandling: 'merge',
    });
  }

  protected submitSearch(term: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { search: term.trim() || null, page: null },
      queryParamsHandling: 'merge',
    });
  }

  protected goToPage(page: number): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: page > 1 ? page : null },
      queryParamsHandling: 'merge',
    });
  }

  private applySeo(category: string | null, search: string | null): void {
    const suffix = category ? ` · ${category}` : search ? ` · "${search}"` : '';
    this.seo.apply({
      title: `Eventos${suffix} — Pasa Eventos`,
      description: 'Descubre y compra boletos para los mejores eventos en Guatemala.',
      path: '/',
      type: 'website',
    });
  }
}
