import { ChangeDetectionStrategy, Component, Injector, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ThemeService } from '../../core/theme/theme.service';
import { SessionStore } from '../../core/auth/session.store';
import { UsersApi } from '../../core/api/users.api';

/**
 * Botón de cambio de TEMA (franja día/noche) para el header. Se muestra SOLO si el
 * admin habilitó el switch (`theme.allowVisitorSwitch`), igual que el de idioma. Un
 * click alterna la franja y aplica el tema al instante (estampa `data-theme`). Si hay
 * SESIÓN, además persiste la preferencia en el perfil (`PATCH /users/me {themePref}`);
 * si es visitante, queda en cookie (efímera). El sol = día, la luna = noche.
 */
@Component({
  selector: 'app-theme-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    @if (theme.canSwitch()) {
    <button
      type="button"
      class="theme-toggle"
      [attr.aria-label]="label() | translate"
      [title]="label() | translate"
      (click)="toggle()"
      data-testid="theme-toggle"
    >
      @if (theme.franja() === 'noche') {
      <!-- estamos en NOCHE → ofrecer pasar a DÍA (sol) -->
      <svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
      } @else {
      <!-- estamos en DÍA → ofrecer pasar a NOCHE (luna) -->
      <svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
      }
    </button>
    }
  `,
  styles: [
    `
      .theme-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 0.5rem;
        padding: 0.3rem;
        cursor: pointer;
        color: currentColor;
        opacity: 0.6;
        transition: opacity 0.15s ease, border-color 0.15s ease, background 0.15s ease;
      }
      .theme-toggle:hover {
        opacity: 1;
        border-color: var(--pe-border);
        background: var(--pe-accent-soft);
      }
      .ic {
        width: 20px;
        height: 20px;
        display: block;
      }
    `,
  ],
})
export class ThemeSwitcherComponent {
  protected readonly theme = inject(ThemeService);
  private readonly session = inject(SessionStore);
  // UsersApi (→ ApiClient → HttpClient) se resuelve DIFERIDO al alternar: así, con
  // solo renderizar el switcher (header) no se arrastra HttpClient a los specs.
  private readonly injector = inject(Injector);

  /** Etiqueta según a qué franja se va a cambiar. */
  protected readonly label = computed(() =>
    this.theme.franja() === 'noche' ? 'shell.themeToDay' : 'shell.themeToNight',
  );

  toggle(): void {
    if (!this.theme.canSwitch()) return;
    this.theme.toggle();
    // Persistir en el perfil solo si hay sesión (visitante → cookie efímera del ThemeService).
    if (this.session.isAuthenticated()) {
      const franja = this.theme.franja();
      this.injector.get(UsersApi).updateMe({ themePref: franja }).subscribe({
        next: (user) => this.session.setUser(user),
        error: () => {
          /* la preferencia igual aplicó localmente; no bloquear por un fallo de red */
        },
      });
    }
  }
}
