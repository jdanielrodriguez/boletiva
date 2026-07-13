import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../core/auth/auth.service';
import { OtpInputComponent } from '../ui/otp-input/otp-input.component';

/**
 * Modal de login (amigable, sin salir de la página). Reusa AuthService: password
 * + 2FA (OTP). Emite `loggedIn` al iniciar sesión y `dismiss` al cerrar. Se usa
 * al "Continuar al pago" para no perder la selección/reserva.
 */
@Component({
  selector: 'app-login-modal',
  imports: [FormsModule, TranslatePipe, OtpInputComponent],
  templateUrl: './login-modal.component.html',
})
export class LoginModal {
  readonly loggedIn = output<void>();
  readonly dismiss = output<void>();

  private readonly auth = inject(AuthService);
  private readonly translate = inject(TranslateService);

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly code = signal('');
  protected readonly needs2fa = signal(false);
  protected readonly method = signal<'email' | 'totp'>('email');
  protected readonly error = signal<string | null>(null);
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
        this.loggedIn.emit();
      },
      error: () => {
        this.submitting.set(false);
        this.error.set(this.translate.instant('auth.msgInvalidCredentials'));
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
        this.loggedIn.emit();
      },
      error: () => {
        this.submitting.set(false);
        this.error.set(this.translate.instant('auth.msgInvalidCode'));
      },
    });
  }

  close(): void {
    this.dismiss.emit();
  }
}
