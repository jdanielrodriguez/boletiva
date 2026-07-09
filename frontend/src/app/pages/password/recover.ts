import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/ui/toast.service';

/**
 * Recuperar contraseña (no autenticado): pide el correo y dispara
 * POST /auth/forgot-password. La respuesta es neutra (no revela si el correo
 * existe) → siempre mostramos el mismo mensaje "revisa tu correo".
 */
@Component({
  selector: 'app-password-recover',
  imports: [FormsModule, RouterLink],
  templateUrl: './recover.html',
})
export class PasswordRecover {
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);

  protected readonly email = signal('');
  protected readonly submitting = signal(false);
  protected readonly sent = signal(false);

  submit(): void {
    const email = this.email().trim();
    if (!email) {
      this.toasts.warning('Ingresa tu correo.');
      return;
    }
    this.submitting.set(true);
    this.auth.forgotPassword({ email }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.sent.set(true);
        this.toasts.success('Si el correo existe, te enviamos un enlace para restablecer tu contraseña.');
      },
      error: () => {
        // Respuesta neutra igualmente: no revelamos el error al usuario.
        this.submitting.set(false);
        this.sent.set(true);
        this.toasts.success('Si el correo existe, te enviamos un enlace para restablecer tu contraseña.');
      },
    });
  }
}
