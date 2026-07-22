import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../core/auth/auth.service';
import { safeReturnUrl } from '../../core/auth/guards';
import { OtpInputComponent } from '../../shared/ui/otp-input/otp-input.component';
import { IconComponent } from '../../shared/icon/icon.component';

/**
 * Login: contraseña + segundo factor (email OTP o TOTP). En dispositivos nuevos
 * el backend exige 2FA (status `2fa_required` + preauthToken); mostramos el
 * campo de código y completamos con /auth/2fa/verify.
 */
@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink, TranslatePipe, OtpInputComponent, IconComponent],
  templateUrl: './login.html',
})
export class Login implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly translate = inject(TranslateService);

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly code = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly needs2fa = signal(false);
  protected readonly method = signal<'email' | 'totp'>('email');
  protected readonly submitting = signal(false);
  protected readonly resending = signal(false);
  protected readonly resendCooldown = signal(0);
  /** Duración total del cooldown vigente (para la barra de progreso del reloj). */
  protected readonly resendTotal = signal(60);
  /** % restante del cooldown → ancho de la barra que se vacía (100→0). */
  protected readonly resendPct = computed(() =>
    this.resendTotal() > 0 ? Math.round((this.resendCooldown() / this.resendTotal()) * 100) : 0,
  );
  protected readonly info = signal<string | null>(null);
  private resendTimer: ReturnType<typeof setInterval> | null = null;

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
        this.error.set(this.translate.instant('auth.msgInvalidCredentials'));
      },
    });
  }

  /** Reenvía el código 2FA por correo (con cooldown; TOTP no aplica). */
  resendCode(): void {
    if (!this.preauthToken || this.resending() || this.resendCooldown() > 0) return;
    this.resending.set(true);
    this.info.set(null);
    this.error.set(null);
    this.auth.resend2fa(this.preauthToken).subscribe({
      next: (res) => {
        this.resending.set(false);
        if (res.resent) {
          this.info.set(this.translate.instant('auth.msg2faResent'));
          this.startResendCooldown(60); // servidor: 1 reenvío por minuto
        }
      },
      error: (err: { status?: number }) => {
        this.resending.set(false);
        // 429: cooldown activo o tope de reenvíos alcanzado (mensaje del backend).
        if (err?.status === 429) {
          this.error.set(this.translate.instant('auth.msg2faResendLimit'));
          this.startResendCooldown(60);
        } else {
          this.error.set(this.translate.instant('auth.msg2faResendError'));
        }
      },
    });
  }

  private startResendCooldown(seconds: number): void {
    this.resendTotal.set(seconds);
    this.resendCooldown.set(seconds);
    if (this.resendTimer) clearInterval(this.resendTimer);
    this.resendTimer = setInterval(() => {
      const n = this.resendCooldown() - 1;
      this.resendCooldown.set(Math.max(0, n));
      if (n <= 0 && this.resendTimer) {
        clearInterval(this.resendTimer);
        this.resendTimer = null;
        // A 0: desaparece el cronómetro y se limpia el aviso → el botón queda habilitado.
        this.info.set(null);
        this.error.set(null);
      }
    }, 1000);
  }

  /** Vuelve al paso de credenciales (p.ej. cuenta equivocada). */
  backToCredentials(): void {
    this.needs2fa.set(false);
    this.preauthToken = null;
    this.code.set('');
    this.error.set(null);
    this.info.set(null);
    this.resendCooldown.set(0);
    if (this.resendTimer) clearInterval(this.resendTimer);
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
        this.error.set(this.translate.instant('auth.msgInvalidCode'));
      },
    });
  }

  private done(): void {
    // Sanea el returnUrl (evita open-redirect) con la misma regla que el guestGuard.
    void this.router.navigateByUrl(safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl')));
  }

  ngOnDestroy(): void {
    if (this.resendTimer) clearInterval(this.resendTimer);
  }
}
