import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { BackLinkComponent } from '../../shared/ui/back-link.component';
import { ScopeDashboardComponent } from '../../shared/scope-dashboard/scope-dashboard.component';

/**
 * Página aparte del DASHBOARD de una plantilla (admin). Botón rápido de regreso a
 * la lista de plantillas. Agrega los eventos que usan la plantilla (vía sus salones).
 */
@Component({
  selector: 'app-template-dashboard-page',
  imports: [TranslatePipe, BackLinkComponent, ScopeDashboardComponent],
  template: `
    <section class="config-page">
      <div class="page-head-row">
        <app-back-link
          link="/configuracion"
          [queryParams]="{ tab: 'plantillas' }"
          testId="back-templates"
          [label]="'config.dash.backTemplates' | translate"
        />
      </div>
      <h1>{{ 'config.dash.templateTitle' | translate }}</h1>
      <app-scope-dashboard kind="template" [id]="id()" />
    </section>
  `,
})
export class TemplateDashboardPage {
  private readonly route = inject(ActivatedRoute);
  protected readonly id = signal<string>(this.route.snapshot.paramMap.get('id') ?? '');
}
