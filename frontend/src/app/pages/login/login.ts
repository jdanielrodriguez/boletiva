import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

/**
 * Login: contraseña + segundo factor (email OTP o TOTP). En dispositivos nuevos
 * el backend exige 2FA (status `2fa_required` + preauthToken); mostramos el
 * campo de código y completamos con /auth/2fa/verify.
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
  protected readonly code = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly needs2fa = signal(false);
  protected readonly method = signal<'email' | 'totp'>('email');
  protected readonly submitting = signal(false);

  private preauthToken: string | null = null;

  submit(): void {
    this.error.set(null);
    this.submitting.set(true);
    this.auth.login({ email: this.email(), password: this.password() }).subscribe({
      next: (res) => {
        this.submitting.set(false);
        if (res.status === '2fa_required') {
          this.needs2fa.set(true);
          this.method.set(res.method ?? 'email');
          this.preauthToken = res.preauthToken ?? null;
          return;
        }
        this.done();
      },
      error: () => {
        this.submitting.set(false);
        this.error.set('Credenciales inválidas.');
      },
    });
  }

  verify(): void {
    if (!this.preauthToken) return;
    this.error.set(null);
    this.submitting.set(true);
    this.auth.verify2fa({ preauthToken: this.preauthToken, code: this.code() }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.done();
      },
      error: () => {
        this.submitting.set(false);
        this.error.set('Código inválido o expirado.');
      },
    });
  }

  private done(): void {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/';
    void this.router.navigateByUrl(returnUrl);
  }
}
