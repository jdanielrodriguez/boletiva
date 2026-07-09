import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { InvitationsApi } from '../../core/api/invitations.api';

/**
 * Registro de cuenta (F4). Si llega con `?token=` de una invitación de promotor,
 * precarga y bloquea el correo (peek) y, tras el alta, acepta la invitación → la
 * cuenta queda AUTO-APROBADA como promotor. Sin token es un alta normal. Ruta solo
 * para invitados (guestGuard).
 */
@Component({
  selector: 'app-register',
  imports: [FormsModule, RouterLink],
  templateUrl: './register.html',
})
export class Register {
  private readonly auth = inject(AuthService);
  private readonly invitations = inject(InvitationsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly firstName = signal('');
  protected readonly lastName = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly working = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Token de invitación (si vino en la URL) y si el correo quedó bloqueado. */
  private token: string | null = null;
  protected readonly invited = signal(false);

  constructor() {
    this.token = this.route.snapshot.queryParamMap.get('token');
    if (this.token) {
      this.invitations.peek(this.token).subscribe({
        next: (res) => {
          this.email.set(res.email);
          this.invited.set(true);
        },
        error: () => this.error.set('La invitación no es válida o venció.'),
      });
    }
  }

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

  /** Acepta la invitación (auto-aprueba promotor) y continúa; si falla, continúa igual. */
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
