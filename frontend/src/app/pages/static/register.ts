import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
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
  imports: [FormsModule, RouterLink],
  templateUrl: './register.html',
})
export class Register {
  private readonly auth = inject(AuthService);
  private readonly session = inject(SessionStore);
  private readonly invitations = inject(InvitationsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);

  protected readonly firstName = signal('');
  protected readonly lastName = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly working = signal(false);
  protected readonly error = signal<string | null>(null);

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
          this.error.set('La invitación no es válida o venció.');
          return;
        }
        this.invitedEmail.set(res.email);
        this.email.set(res.email);
        this.mode.set(res.accountExists ? 'activate' : 'register');
      },
      error: () => {
        this.mode.set('invalid');
        this.error.set('La invitación no es válida o venció.');
      },
    });
  }

  /** Alta de cuenta nueva (invitada o normal) → verifica correo; si invitada, acepta. */
  protected submit(): void {
    if (!this.email() || !this.password() || !this.firstName()) {
      this.error.set('Completa nombre, correo y contraseña.');
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
        next: () => (this.token ? this.acceptThenGo(this.token) : this.done()),
        error: () => {
          this.working.set(false);
          this.error.set('No se pudo crear la cuenta (¿el correo ya está registrado?).');
        },
      });
  }

  /** Activación de un click (cuenta existente con sesión del correo invitado). */
  protected activate(): void {
    if (!this.token) return;
    this.working.set(true);
    this.invitations.acceptByToken(this.token).subscribe({
      next: () => {
        this.working.set(false);
        this.toasts.success('¡Listo! Tu cuenta ahora es promotora. Vuelve a iniciar sesión para verlo.');
        void this.router.navigate(['/promotor']);
      },
      error: () => {
        this.working.set(false);
        this.toasts.error('No se pudo activar (¿la invitación venció o ya la usaste?).');
      },
    });
  }

  private acceptThenGo(token: string): void {
    this.invitations.accept(token).subscribe({
      next: () => this.done(),
      error: () => this.done(),
    });
  }

  private done(): void {
    this.working.set(false);
    void this.router.navigate(['/verificar-correo']);
  }
}
