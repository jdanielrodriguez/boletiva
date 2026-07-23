import { Component, RESPONSE_INIT, inject } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { SeoService } from '../../core/seo/seo.service';

/**
 * Página 404 (G3.2 · auditoría 4): antes cualquier ruta desconocida redirigía mudo al
 * inicio. Ahora muestra un 404 real con enlaces útiles, fija `status=404` en SSR (para
 * SEO/monitoreo) y marca la página como `noindex`. Mismo patrón que event-detail notFound.
 */
@Component({
  selector: 'app-not-found',
  imports: [TranslatePipe, EmptyStateComponent],
  template: `
    <section class="not-found">
      <app-empty-state
        variant="generic"
        data-testid="not-found"
        [title]="'shell.notFoundTitle' | translate"
        [subtitle]="'shell.notFoundBody' | translate"
        [ctaLabel]="'shell.verifyBackHome' | translate"
        ctaLink="/"
      />
    </section>
  `,
  styles: [`.not-found { max-width: 720px; margin: 2rem auto; padding: 0 1rem; }`],
})
export class NotFoundPage {
  private readonly responseInit = inject(RESPONSE_INIT, { optional: true });
  private readonly seo = inject(SeoService);
  private readonly translate = inject(TranslateService);

  constructor() {
    // En SSR marca el HTTP status como 404 (no 200) para SEO/monitoreo.
    if (this.responseInit) this.responseInit.status = 404;
    this.seo.apply({
      title: this.translate.instant('shell.notFoundTitle') + ' — Boletiva',
      description: this.translate.instant('shell.notFoundBody'),
      path: '/404',
      noindex: true,
    });
  }
}
