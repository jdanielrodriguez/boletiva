import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../core/auth/auth.service';
import { SessionStore } from '../../core/auth/session.store';
import { ToastService } from '../../core/ui/toast.service';
import { apiErrorMessage } from '../../core/http/api-error';
import { OtpInputComponent } from '../ui/otp-input/otp-input.component';
import { ResendCodeComponent } from '../ui/resend-code.component';
import { IconComponent } from '../icon/icon.component';

/**
 * Modal GLOBAL de verificación de correo. Se muestra ENCIMA DE TODO (backdrop no
 * cerrable) siempre que la sesión esté autenticada pero el correo aún NO esté
 * verificado — cubre tanto el post-registro (auto-login sin verificar) como el
 * login posterior de una cuenta sin verificar. Pide el código de 6 dígitos que el
 * backend envió por correo (`POST /auth/verify-email`), permite reenviarlo
 * (`/auth/resend-verification`) y ofrece cerrar sesión para no atrapar al usuario.
 * Al verificar, la sesión se refresca (emailVerified=true) y el modal desaparece.
 * SSR-safe: en el servidor la sesión es anónima → `visible` es false, no renderiza.
 */
@Component({
  selector: 'app-email-verification-modal',
  imports: [FormsModule, TranslatePipe, OtpInputComponent, ResendCodeComponent, IconComponent],
  templateUrl: './email-verification-modal.component.html',
})
export class EmailVerificationModal {
  private readonly session = inject(SessionStore);
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly resendCtl = viewChild(ResendCodeComponent);

  protected readonly visible = computed(
    () => this.session.isAuthenticated() && !this.session.isEmailVerified(),
  );
  protected readonly email = computed(() => this.session.user()?.email ?? '');
  protected readonly code = signal('');
  protected readonly working = signal(false);
  protected readonly resending = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly info = signal<string | null>(null);

  protected onCode(value: string): void {
    this.code.set(value);
    this.error.set(null);
    if (value.length === 6) this.verify();
  }

  protected verify(): void {
    if (this.code().length < 6 || this.working()) return;
    this.working.set(true);
    this.error.set(null);
    this.auth.verifyEmail(this.code()).subscribe({
      next: () => {
        this.working.set(false);
        this.code.set('');
        this.toasts.success(this.translate.instant('auth.verifyOk'));
        // La sesión ya quedó verificada → `visible` pasa a false y el modal se cierra.
      },
      error: (err) => {
        this.working.set(false);
        this.code.set('');
        this.error.set(apiErrorMessage(err, this.translate.instant('auth.verifyFailed')));
      },
    });
  }

  protected resend(): void {
    if (this.resending()) return;
    this.resending.set(true);
    this.info.set(null);
    this.error.set(null);
    this.auth.resendVerification().subscribe({
      next: () => {
        this.resending.set(false);
        // Estado en línea + cronómetro (estandarizado con login/compra, F2).
        this.info.set(this.translate.instant('auth.verifyResent'));
        this.resendCtl()?.startCooldown(60);
      },
      error: (err) => {
        this.resending.set(false);
        this.error.set(apiErrorMessage(err, this.translate.instant('auth.verifyResendFailed')));
        if ((err as { status?: number })?.status === 429) this.resendCtl()?.startCooldown(60);
      },
    });
  }

  protected signOut(): void {
    // Navega a inicio SIEMPRE (no dejar al usuario en una vista protegida con la
    // sesión ya cerrada; los guards solo corren al ENTRAR a la ruta).
    this.auth.logout().subscribe({
      next: () => void this.router.navigateByUrl('/'),
      error: () => void this.router.navigateByUrl('/'),
      complete: () => void this.router.navigateByUrl('/'),
    });
  }
}
