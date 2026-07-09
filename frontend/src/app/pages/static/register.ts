import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Registro (placeholder; el alta completa de cuenta llega en la fase de cuenta). */
@Component({
  selector: 'app-register',
  imports: [RouterLink],
  template: `
    <div class="auth-wrap">
      <section class="auth-card">
        <h1>Crear cuenta</h1>
        <p class="auth-sub">El registro estará disponible muy pronto.</p>
        <p class="auth-alt">¿Ya tienes cuenta? <a routerLink="/login">Inicia sesión</a></p>
      </section>
    </div>
  `,
})
export class Register {}
