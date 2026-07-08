import { Component } from '@angular/core';

/** Página 403: sesión válida pero sin el rol necesario. */
@Component({
  selector: 'app-forbidden',
  template: `
    <section class="forbidden">
      <h1>403 — Sin permiso</h1>
      <p>Tu cuenta no tiene acceso a esta sección.</p>
      <a href="/">Volver al inicio</a>
    </section>
  `,
})
export class Forbidden {}
