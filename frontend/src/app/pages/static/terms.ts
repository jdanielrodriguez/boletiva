import { Component } from '@angular/core';

/** Términos y condiciones (placeholder; el texto legal definitivo llega luego). */
@Component({
  selector: 'app-terms',
  template: `
    <section class="static-page">
      <h1>Términos y condiciones</h1>
      <p>
        Al usar Pasa Eventos aceptas nuestras condiciones de compra, la política de reembolsos según
        cada evento y el tratamiento de tus datos conforme a la ley aplicable en Guatemala.
      </p>
      <p>El contenido legal completo se publicará próximamente.</p>
    </section>
  `,
})
export class Terms {}
