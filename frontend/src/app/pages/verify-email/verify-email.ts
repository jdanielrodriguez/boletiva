import { Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/** Placeholder de verificación de correo (flujo completo en F3). */
@Component({
  selector: 'app-verify-email',
  imports: [TranslatePipe],
  template: `
    <section class="verify-email">
      <h1>{{ 'shell.verifyTitle' | translate }}</h1>
      <p>{{ 'shell.verifyBody' | translate }}</p>
      <a href="/">{{ 'shell.verifyBackHome' | translate }}</a>
    </section>
  `,
})
export class VerifyEmail {}
