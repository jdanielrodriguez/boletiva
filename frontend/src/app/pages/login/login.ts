import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

/**
 * Login mínimo (email + contraseña) que ejercita el circuito de sesión de F0.
 * El flujo completo (passwordless, Google, 2FA UI, verificación) se desarrolla
 * en la fase de cuenta (F1/F3). Aquí solo probamos tokens + sesión + redirección.
 */
@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  templateUrl: './login.html',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly needs2fa = signal(false);
  protected readonly submitting = signal(false);

  submit(): void {
    this.error.set(null);
    this.submitting.set(true);
    this.auth.login({ email: this.email(), password: this.password() }).subscribe({
      next: (res) => {
        this.submitting.set(false);
        if (res.status === '2fa_required') {
          this.needs2fa.set(true);
          return;
        }
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/';
        void this.router.navigateByUrl(returnUrl);
      },
      error: () => {
        this.submitting.set(false);
        this.error.set('Credenciales inválidas.');
      },
    });
  }
}
