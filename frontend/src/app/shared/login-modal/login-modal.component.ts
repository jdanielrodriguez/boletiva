import { Component, HostListener, inject, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../core/auth/auth.service';
import { OtpInputComponent } from '../ui/otp-input/otp-input.component';
import { ResendCodeComponent } from '../ui/resend-code.component';

/**
 * Modal de login (amigable, sin salir de la página). Reusa AuthService: password
 * + 2FA (OTP). Emite `loggedIn` al iniciar sesión y `dismiss` al cerrar. Se usa
 * al "Continuar al pago" para no perder la selección/reserva.
 */
@Component({
  selector: 'app-login-modal',
  imports: [FormsModule, TranslatePipe, OtpInputComponent, ResendCodeComponent],
  host: { '(document:keydown.escape)': 'dismiss.emit()' },
  templateUrl: './login-modal.component.html',
})
export class LoginModal {
  readonly loggedIn = output<void>();
  readonly dismiss = output<void>();

  private readonly auth = inject(AuthService);
  private readonly translate = inject(TranslateService);
  private readonly resendCtl = viewChild(ResendCodeComponent);

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly code = signal('');
  protected readonly needs2fa = signal(false);
  protected readonly method = signal<'email' | 'totp'>('email');
  protected readonly error = signal<string | null>(null);
  protected readonly info = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly resending = signal(false);

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

  /** Reenvía el código 2FA por correo (con cooldown; TOTP no aplica). Estandarizado (F2). */
  resendCode(): void {
    if (!this.preauthToken || this.resending()) return;
    this.resending.set(true);
    this.info.set(null);
    this.error.set(null);
    this.auth.resend2fa(this.preauthToken).subscribe({
      next: (res) => {
        this.resending.set(false);
        if (res.resent) {
          this.info.set(this.translate.instant('auth.msg2faResent'));
          this.resendCtl()?.startCooldown(60); // servidor: 1 reenvío por minuto
        }
      },
      error: (err: { status?: number }) => {
        this.resending.set(false);
        if (err?.status === 429) {
          this.error.set(this.translate.instant('auth.msg2faResendLimit'));
          this.resendCtl()?.startCooldown(60);
        } else {
          this.error.set(this.translate.instant('auth.msg2faResendError'));
        }
      },
    });
  }

  close(): void {
    this.dismiss.emit();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.close();
  }
}
