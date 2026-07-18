import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { SessionStore } from '../../core/auth/session.store';
import { UsersApi } from '../../core/api/users.api';
import { PublicConfigStore } from '../../core/config/public-config.store';

/** Un paso del tour: título + cuerpo (claves i18n ya resueltas por el padre o texto). */
export interface TourStep {
  title: string;
  body: string;
}

/**
 * % de VISITANTES ANÓNIMOS a los que se les ofrece el tour (activación aleatoria
 * ESTABLE por navegador): de cada 10 que llegan, ~5 o menos lo ven → no molesta a
 * todos. La tirada se hace una sola vez y se guarda; el resto nunca ve tours.
 */
const ANON_SHOW_PCT = 50;

/**
 * Tour de onboarding LIGERO (overlay modal con pasos). Reglas de aparición:
 *  - Global OFF si el admin apaga `tour.enabled` (setting) → nunca aparece.
 *  - LOGUEADO: se muestra una vez por página y usuario; al ver/saltar se marca en el
 *    perfil (`POST /users/me/tours`) → no vuelve a salir.
 *  - ANÓNIMO: activación ALEATORIA estable (~{@link ANON_SHOW_PCT}% de visitantes) +
 *    "visto" persistido en localStorage por página → no molesta a todos ni se repite.
 * Sin anclaje a elementos (a prueba de layout); pasos como tarjetas.
 */
@Component({
  selector: 'app-tour',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    @if (visible()) {
      <div class="tour-backdrop" data-testid="tour" role="dialog" aria-modal="true">
        <div class="tour-card">
          <p class="tour-step-count">{{ index() + 1 }} / {{ steps().length }}</p>
          <h3 class="tour-title">{{ steps()[index()].title | translate }}</h3>
          <p class="tour-body">{{ steps()[index()].body | translate }}</p>
          <div class="tour-actions">
            <button type="button" class="btn ghost" (click)="skip()" data-testid="tour-skip">
              {{ 'tour.skip' | translate }}
            </button>
            <span class="tour-spacer"></span>
            @if (index() > 0) {
              <button type="button" class="btn" (click)="back()" data-testid="tour-back">{{ 'tour.back' | translate }}</button>
            }
            @if (index() < steps().length - 1) {
              <button type="button" class="btn primary" (click)="next()" data-testid="tour-next">{{ 'tour.next' | translate }}</button>
            } @else {
              <button type="button" class="btn primary" (click)="finish()" data-testid="tour-finish">{{ 'tour.finish' | translate }}</button>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .tour-backdrop { position: fixed; inset: 0; z-index: 1200; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); padding: 1rem; }
      .tour-card { background: var(--pe-surface, #14151c); color: var(--pe-text, #f5f6fa); border: 1px solid var(--pe-border, #2a2c36); border-radius: 14px; max-width: 420px; width: 100%; padding: 1.25rem; box-shadow: 0 20px 50px rgba(0,0,0,.4); }
      .tour-step-count { color: var(--pe-muted); font-size: .78rem; margin: 0 0 .25rem; }
      .tour-title { margin: 0 0 .5rem; }
      .tour-body { color: var(--pe-muted); margin: 0 0 1rem; }
      .tour-actions { display: flex; align-items: center; gap: .5rem; }
      .tour-spacer { flex: 1; }
    `,
  ],
})
export class TourComponent {
  private readonly session = inject(SessionStore);
  private readonly usersApi = inject(UsersApi);
  private readonly config = inject(PublicConfigStore);
  private readonly platformId = inject(PLATFORM_ID);

  /** Clave única del tour (p.ej. 'home', 'promoter'). */
  readonly tourKey = input.required<string>();
  /** Pasos (claves i18n de título/cuerpo). */
  readonly steps = input.required<TourStep[]>();

  protected readonly index = signal(0);
  private readonly dismissed = signal(false);
  /** Elegibilidad del visitante ANÓNIMO (tirada aleatoria estable), resuelta en cliente. */
  private readonly anonEligible = signal(false);

  constructor() {
    // La tirada aleatoria y localStorage solo existen en el navegador; se evalúa una
    // vez tras el primer render (con el `tourKey` ya enlazado).
    afterNextRender(() => this.anonEligible.set(this.resolveAnonEligible()));
  }

  /**
   * Visible si el tour está habilitado (setting admin `tour.enabled`), no se descartó, y:
   *  - LOGUEADO: el tour NO está en los vistos del perfil (una vez por usuario/página).
   *  - ANÓNIMO (sesión ya resuelta): salió elegido en la tirada aleatoria y no lo ha visto.
   */
  protected readonly visible = computed(() => {
    if (!this.config.tourEnabled()) return false; // el admin puede apagar todos los tours
    if (this.dismissed()) return false;
    const u = this.session.user();
    if (u) return !(u.toursSeen ?? []).includes(this.tourKey()); // logueado → perfil
    // Anónimo: solo cuando la config REAL ya cargó del backend (evita decidir con el
    // default; en tests la config no se carga → el tour anónimo queda apagado) y la
    // sesión ya resolvió (no parpadea para un logueado cuya sesión aún carga).
    if (!this.config.loaded() || !this.session.loaded()) return false;
    return this.anonEligible(); // anónimo → tirada aleatoria estable + localStorage
  });

  /** localStorage tolerante a SSR / modo privado. */
  private ls(): Storage | null {
    try {
      return isPlatformBrowser(this.platformId) && typeof localStorage !== 'undefined'
        ? localStorage
        : null;
    } catch {
      return null;
    }
  }

  /**
   * ¿Se le ofrece el tour a ESTE visitante anónimo? Solo si no lo ha visto y salió
   * dentro del porcentaje elegido. La tirada (0–99) se guarda una vez por navegador
   * → estable entre páginas y recargas (o ve tours o nunca; no parpadea).
   */
  private resolveAnonEligible(): boolean {
    const ls = this.ls();
    if (!ls) return false;
    try {
      if (ls.getItem(`pe.tour.seen.${this.tourKey()}`)) return false;
      let roll = ls.getItem('pe.tour.roll');
      if (roll === null) {
        roll = String(Math.floor(Math.random() * 100));
        ls.setItem('pe.tour.roll', roll);
      }
      return Number(roll) < ANON_SHOW_PCT;
    } catch {
      return false;
    }
  }

  protected next(): void {
    this.index.update((i) => Math.min(i + 1, this.steps().length - 1));
  }
  protected back(): void {
    this.index.update((i) => Math.max(i - 1, 0));
  }
  protected finish(): void {
    this.markSeen();
  }
  protected skip(): void {
    this.markSeen();
  }

  /**
   * Marca el tour visto y lo oculta (optimista). Logueado → perfil (`POST /users/me/
   * tours`); anónimo → localStorage (para que no reaparezca al recargar).
   */
  private markSeen(): void {
    this.dismissed.set(true);
    if (!this.session.user()) {
      const ls = this.ls();
      try {
        ls?.setItem(`pe.tour.seen.${this.tourKey()}`, '1');
      } catch {
        /* modo privado / cuota: se queda oculto solo en esta sesión */
      }
      return;
    }
    this.usersApi.markTourSeen(this.tourKey()).subscribe({
      next: (u) => this.session.setUser(u),
      error: () => {
        /* si falla, igual quedó oculto en esta sesión; reaparece al recargar */
      },
    });
  }
}
