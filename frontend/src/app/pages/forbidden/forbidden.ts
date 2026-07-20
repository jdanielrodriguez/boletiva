import { Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';

/** Página 403: sesión válida pero sin el rol necesario. */
@Component({
  selector: 'app-forbidden',
  imports: [TranslatePipe, EmptyStateComponent],
  template: `
    <section class="forbidden">
      <app-empty-state
        variant="generic"
        [title]="'shell.forbiddenTitle' | translate"
        [subtitle]="'shell.forbiddenBody' | translate"
        [ctaLabel]="'shell.verifyBackHome' | translate"
        ctaLink="/"
      />
    </section>
  `,
})
export class Forbidden {}
