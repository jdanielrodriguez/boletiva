import { Component, PLATFORM_ID, computed, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { catchError, map, of, startWith, switchMap, tap } from 'rxjs';
import { CategoriesApi } from '../../core/api/categories.api';
import { EventsApi } from '../../core/api/events.api';
import type { PublicEventListDto } from '../../core/api/types';
import { PublicConfigStore } from '../../core/config/public-config.store';
import { LocalizedDatePipe } from '../../core/i18n/localized-date.pipe';
import { SeoService } from '../../core/seo/seo.service';
import { HeroSlider, SlideItem } from '../../shared/hero-slider/hero-slider.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { LoadingComponent } from '../../shared/ui/loading.component';
import { SearchFieldComponent } from '../../shared/ui/search-field.component';
import { PagerComponent } from '../../shared/ui/pager.component';
import { TourComponent, TourStep } from '../../shared/tour/tour.component';

const PAGE_SIZE = 12;

/** Estado de la consulta del catálogo (distingue OK de error, para vistas propias). */
interface CatalogResult {
  ok: boolean;
  data: PublicEventListDto | null;
}

/**
 * Catálogo público de eventos. SSR + SEO: se renderiza en el servidor con los
 * datos ya resueltos y es cacheable en el edge (contenido anónimo). Los filtros
 * (categoría/búsqueda/página) viven en la query string → URLs compartibles e
 * indexables; cambiarlos re-consulta el API.
 */
@Component({
  selector: 'app-catalog',
  imports: [
    RouterLink,
    LocalizedDatePipe,
    TranslatePipe,
    HeroSlider,
    PagerComponent,
    EmptyStateComponent,
    LoadingComponent,
    SearchFieldComponent,
    TourComponent,
  ],
  templateUrl: './catalog.html',
})
export class Catalog {
  private readonly eventsApi = inject(EventsApi);

  /** Tour de onboarding del inicio (solo logueados no-vistos). */
  protected readonly tourSteps: TourStep[] = [
    { title: 'tour.home.welcomeTitle', body: 'tour.home.welcomeBody' },
    { title: 'tour.home.browseTitle', body: 'tour.home.browseBody' },
    { title: 'tour.home.accountTitle', body: 'tour.home.accountBody' },
  ];
  private readonly categoriesApi = inject(CategoriesApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly seo = inject(SeoService);
  private readonly publicConfig = inject(PublicConfigStore);

  protected readonly pageSize = PAGE_SIZE;

  /** Flag de admin: ¿mostrar las categorías en el inicio? (v3.10 · GI). */
  protected readonly showCategories = this.publicConfig.showHomeCategories;

  constructor() {
    // W2/W10: re-consulta la config pública al entrar al inicio → una navegación
    // fresca toma los cambios del admin (categorías/idioma) sin necesidad de un F5.
    // Solo en el navegador (el store se hidrata allí; en SSR van los defaults).
    if (isPlatformBrowser(inject(PLATFORM_ID))) this.publicConfig.refresh();
  }

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
          .pipe(
            map((data): CatalogResult => ({ ok: true, data })),
            catchError(() => of<CatalogResult>({ ok: false, data: null })),
            startWith(null as CatalogResult | null),
          );
      }),
    ),
    { initialValue: null as CatalogResult | null },
  );

  protected readonly events = computed(() => this.result()?.data?.items ?? []);
  protected readonly total = computed(() => this.result()?.data?.total ?? 0);
  /** null = aún cargando (sin respuesta). */
  protected readonly loading = computed(() => this.result() === null);
  /** Respuesta recibida pero con error (fallo de red/API). */
  protected readonly errored = computed(() => {
    const r = this.result();
    return r !== null && !r.ok;
  });
  /** Hay filtros activos → un vacío es "sin resultados" (no "catálogo vacío"). */
  protected readonly hasFilter = computed(() => !!this.activeCategory() || !!this.search());
  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));

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
    const target = Math.min(Math.max(1, page), this.totalPages());
    if (target === this.page()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: target > 1 ? target : null },
      queryParamsHandling: 'merge',
    });
  }

  private applySeo(category: string | null, search: string | null): void {
    const suffix = category ? ` · ${category}` : search ? ` · "${search}"` : '';
    this.seo.apply({
      title: `Eventos${suffix} — Boletiva`,
      description: 'Descubre y compra boletos para los mejores eventos en Guatemala.',
      path: '/',
      type: 'website',
    });
  }
}
