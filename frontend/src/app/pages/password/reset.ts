import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/ui/toast.service';

/**
 * Restablecer contraseña (no autenticado): recibe `?token=` del enlace del correo
 * y fija la nueva contraseña con POST /auth/reset-password. Al terminar redirige a
 * /login. Servida en /reset-password (path del correo) y /restablecer (alias).
 */
@Component({
  selector: 'app-password-reset',
  imports: [FormsModule, RouterLink],
  templateUrl: './reset.html',
})
export class PasswordReset {
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly token = signal(this.route.snapshot.queryParamMap.get('token') ?? '');
  protected readonly password = signal('');
  protected readonly confirm = signal('');
  protected readonly submitting = signal(false);

  submit(): void {
    const token = this.token().trim();
    if (!token) {
      this.toasts.error('Enlace inválido: falta el token de recuperación.');
      return;
    }
    const password = this.password();
    if (password.length < 8) {
      this.toasts.warning('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== this.confirm()) {
      this.toasts.warning('La confirmación no coincide.');
      return;
    }
    this.submitting.set(true);
    this.auth.resetPassword({ token, password }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.toasts.success('Contraseña restablecida. Ya puedes iniciar sesión.');
        void this.router.navigateByUrl('/login');
      },
      error: () => {
        this.submitting.set(false);
        this.toasts.error('No se pudo restablecer: el enlace pudo expirar o ya fue usado. Solicita uno nuevo.');
      },
    });
  }
}
