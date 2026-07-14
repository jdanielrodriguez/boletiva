import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { BackLinkComponent } from '../../shared/ui/back-link.component';
import { ScopeDashboardComponent } from '../../shared/scope-dashboard/scope-dashboard.component';

/**
 * Página aparte del DASHBOARD de un salón (admin). Botón rápido de regreso a la
 * lista de salones. El contenido lo pinta `app-scope-dashboard` (mismo estilo que
 * el dashboard de evento).
 */
@Component({
  selector: 'app-hall-dashboard-page',
  imports: [TranslatePipe, BackLinkComponent, ScopeDashboardComponent],
  template: `
    <section class="config-page">
      <div class="page-head-row">
        <app-back-link
          link="/configuracion"
          [queryParams]="{ tab: 'salones' }"
          testId="back-halls"
          [label]="'config.dash.backHalls' | translate"
        />
      </div>
      <h1>{{ 'config.dash.hallTitle' | translate }}</h1>
      <app-scope-dashboard kind="hall" [id]="id()" />
    </section>
  `,
})
export class HallDashboardPage {
  private readonly route = inject(ActivatedRoute);
  protected readonly id = signal<string>(this.route.snapshot.paramMap.get('id') ?? '');
}
