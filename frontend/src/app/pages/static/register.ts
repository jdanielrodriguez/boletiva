import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, of, switchMap } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { AuthRefreshService } from '../../core/auth/auth-refresh.service';
import { SessionStore } from '../../core/auth/session.store';
import { InvitationsApi } from '../../core/api/invitations.api';
import { ToastService } from '../../core/ui/toast.service';

/** Modo de la vista según la invitación (o alta normal). */
type Mode = 'loading' | 'register' | 'activate' | 'normal' | 'invalid';

/**
 * Registro / activación de invitación de promotor (v3.5). Con `?token=` resuelve la
 * invitación por `GET /promoters/invitations/by-token/:token`:
 *  - `accountExists=false` → formulario de registro con el correo precargado
 *    (readonly); tras el alta se acepta la invitación (queda auto-aprobado).
 *  - `accountExists=true` → NO se registra: se muestra "Activar mi cuenta de
 *    promotor". Si hay sesión con el correo invitado, un click activa el rol; si no,
 *    se pide iniciar sesión y luego se activa.
 * Sin token es un alta normal. La ruta ya no exige guestGuard (para poder activar
 * estando logueado); si un usuario logueado entra sin token, se le manda a su cuenta.
 */
@Component({
  selector: 'app-register',
  imports: [FormsModule, RouterLink, TranslatePipe],
  templateUrl: './register.html',
})
export class Register {
  private readonly auth = inject(AuthService);
  private readonly refresher = inject(AuthRefreshService);
  private readonly session = inject(SessionStore);
  private readonly invitations = inject(InvitationsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected readonly firstName = signal('');
  protected readonly lastName = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly confirmPassword = signal('');
  protected readonly working = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Aviso genérico (p.ej. correo ya existente → anti-enumeración): no revela nada. */
  protected readonly info = signal<string | null>(null);

  /** Chequeos de fortaleza (checklist en vivo). */
  protected readonly checks = computed(() => {
    const p = this.password();
    return {
      length: p.length >= 8,
      upper: /[A-Z]/.test(p),
      lower: /[a-z]/.test(p),
      number: /\d/.test(p),
      symbol: /[^A-Za-z0-9]/.test(p),
    };
  });
  /** Fuerte = mín. 8 y al menos 3 de las 4 categorías (mayús/minús/número/símbolo). */
  protected readonly strong = computed(() => {
    const c = this.checks();
    const cats = [c.upper, c.lower, c.number, c.symbol].filter(Boolean).length;
    return c.length && cats >= 3;
  });
  protected readonly matches = computed(
    () => this.confirmPassword().length > 0 && this.password() === this.confirmPassword(),
  );

  protected readonly mode = signal<Mode>('loading');
  protected readonly invitedEmail = signal('');
  private token: string | null = null;

  /** ¿La sesión actual corresponde al correo invitado? (activación de un click). */
  protected readonly sameAccount = computed(
    () =>
      this.session.isAuthenticated() &&
      (this.session.user()?.email ?? '').toLowerCase() === this.invitedEmail().toLowerCase(),
  );
  /** URL para volver a activar tras iniciar sesión. */
  protected readonly loginReturnUrl = computed(() =>
    this.token ? `/registro?token=${encodeURIComponent(this.token)}` : '/registro',
  );

  constructor() {
    this.token = this.route.snapshot.queryParamMap.get('token');
    if (!this.token) {
      // Alta normal; si ya hay sesión no tiene sentido registrarse.
      if (this.session.isAuthenticated()) {
        void this.router.navigate(['/cuenta']);
        return;
      }
      this.mode.set('normal');
      return;
    }
    this.invitations.byToken(this.token).subscribe({
      next: (res) => {
        if (!res.valid) {
          this.mode.set('invalid');
          this.error.set(this.translate.instant('auth.msgInvitationInvalid'));
          return;
        }
        this.invitedEmail.set(res.email);
        this.email.set(res.email);
        this.mode.set(res.accountExists ? 'activate' : 'register');
      },
      error: () => {
        this.mode.set('invalid');
        this.error.set(this.translate.instant('auth.msgInvitationInvalid'));
      },
    });
  }

  /** Alta de cuenta nueva (invitada o normal) → verifica correo; si invitada, acepta. */
  protected submit(): void {
    if (!this.email() || !this.password() || !this.firstName()) {
      this.error.set(this.translate.instant('auth.msgCompleteFields'));
      return;
    }
    if (!this.strong()) {
      this.error.set(this.translate.instant('auth.msgPasswordWeak'));
      return;
    }
    if (!this.matches()) {
      this.error.set(this.translate.instant('auth.msgConfirmMismatch'));
      return;
    }
    this.working.set(true);
    this.error.set(null);
    this.auth
      .signup({
        email: this.email(),
        password: this.password(),
        firstName: this.firstName(),
        lastName: this.lastName() || undefined,
      })
      .subscribe({
        next: () => {
          // Correo YA existente (202 anti-enumeración): no hay sesión → aviso genérico
          // (no revela si el correo existe; el backend avisó por correo al dueño real).
          if (!this.session.isAuthenticated()) {
            this.working.set(false);
            this.info.set(this.translate.instant('auth.msgSignupCheckEmail'));
            return;
          }
          if (this.token) this.acceptThenGo(this.token);
          else this.done();
        },
        error: () => {
          this.working.set(false);
          this.error.set(this.translate.instant('auth.msgCreateFailed'));
        },
      });
  }

  /** Activación de un click (cuenta existente con sesión del correo invitado). */
  protected activate(): void {
    if (!this.token) return;
    this.working.set(true);
    this.invitations
      .acceptByToken(this.token)
      // Tras aceptar, el rol `promoter` ya está en BD pero el token vigente sigue
      // con [buyer]: refrescamos (relee roles) y recargamos la sesión (E4).
      .pipe(switchMap(() => this.refreshRole()))
      .subscribe({
        next: () => {
          this.working.set(false);
          this.toasts.success(this.translate.instant('auth.msgActivateOk'));
          void this.router.navigate(['/promotor']);
        },
        error: () => {
          this.working.set(false);
          this.toasts.error(this.translate.instant('auth.msgActivateFailed'));
        },
      });
  }

  private acceptThenGo(token: string): void {
    this.invitations
      .accept(token)
      // Refresca el token + la sesión para que el rol promotor se refleje ya
      // (si no, al reingresar aparecería como cliente). Un fallo aquí no bloquea
      // el flujo: igual va a "verifica tu correo".
      .pipe(switchMap(() => this.refreshRole()))
      .subscribe({
        next: () => this.done(),
        error: () => this.done(),
      });
  }

  /** Refresca el access token (relee roles de BD) y recarga /auth/me. */
  private refreshRole() {
    return this.refresher.refresh().pipe(
      switchMap((t) => (t ? this.session.loadMe() : of(null))),
      catchError(() => of(null)),
    );
  }

  private done(): void {
    this.working.set(false);
    // Tras el alta el backend deja la sesión autenticada pero SIN verificar → el
    // modal global de verificación (montado en app) aparece encima de todo pidiendo
    // el código. Vamos al inicio; el modal se muestra ahí (ya no una página muda).
    void this.router.navigate(['/']);
  }
}
