import { Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/** Términos y condiciones (placeholder; el texto legal definitivo llega luego). */
@Component({
  selector: 'app-terms',
  imports: [TranslatePipe],
  template: `
    <section class="static-page">
      <h1>{{ 'shell.terms' | translate }}</h1>
      <p>{{ 'shell.termsIntro' | translate }}</p>

      <h2>{{ 'shell.termsSecurityTitle' | translate }}</h2>
      <p [innerHTML]="'shell.termsSecurityP1' | translate"></p>
      <p [innerHTML]="'shell.termsSecurityP2' | translate"></p>

      <h2>{{ 'shell.termsWalletTitle' | translate }}</h2>
      <p>{{ 'shell.termsWalletP' | translate }}</p>

      <p>{{ 'shell.termsComingSoon' | translate }}</p>
    </section>
  `,
})
export class Terms {}
