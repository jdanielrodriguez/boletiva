import { Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/** Página 403: sesión válida pero sin el rol necesario. */
@Component({
  selector: 'app-forbidden',
  imports: [TranslatePipe],
  template: `
    <section class="forbidden">
      <h1>{{ 'shell.forbiddenTitle' | translate }}</h1>
      <p>{{ 'shell.forbiddenBody' | translate }}</p>
      <a href="/">{{ 'shell.verifyBackHome' | translate }}</a>
    </section>
  `,
})
export class Forbidden {}
