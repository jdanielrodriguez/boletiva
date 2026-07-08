import { Component } from '@angular/core';

/** Placeholder de verificación de correo (flujo completo en F3). */
@Component({
  selector: 'app-verify-email',
  template: `
    <section class="verify-email">
      <h1>Verifica tu correo</h1>
      <p>Necesitas confirmar tu correo para comprar, crear o transferir boletos.</p>
      <a href="/">Volver al inicio</a>
    </section>
  `,
})
export class VerifyEmail {}
