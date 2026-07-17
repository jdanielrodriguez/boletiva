import { ChangeDetectionStrategy, Component, inject, input, signal, computed } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { SessionStore } from '../../core/auth/session.store';
import { UsersApi } from '../../core/api/users.api';

/** Un paso del tour: título + cuerpo (claves i18n ya resueltas por el padre o texto). */
export interface TourStep {
  title: string;
  body: string;
}

/**
 * Tour de onboarding LIGERO (overlay modal con pasos). Se muestra SOLO a usuarios
 * logueados que aún no han visto el tour (`session.user().toursSeen`). Al completar o
 * saltar, marca el tour como visto en el perfil (`POST /users/me/tours`) → no vuelve a
 * aparecer. Sin anclaje a elementos (a prueba de layout); pasos como tarjetas.
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

  /** Clave única del tour (p.ej. 'home', 'promoter'). */
  readonly tourKey = input.required<string>();
  /** Pasos (claves i18n de título/cuerpo). */
  readonly steps = input.required<TourStep[]>();

  protected readonly index = signal(0);
  private readonly dismissed = signal(false);

  /** Visible si hay sesión, no se descartó, y el tour NO está en los vistos del perfil. */
  protected readonly visible = computed(() => {
    if (this.dismissed()) return false;
    const u = this.session.user();
    if (!u) return false; // el tour persiste en el perfil → solo logueados
    return !(u.toursSeen ?? []).includes(this.tourKey());
  });

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

  /** Marca el tour visto (perfil) y lo oculta. Optimista: se oculta ya. */
  private markSeen(): void {
    this.dismissed.set(true);
    this.usersApi.markTourSeen(this.tourKey()).subscribe({
      next: (u) => this.session.setUser(u),
      error: () => {
        /* si falla, igual quedó oculto en esta sesión; reaparece al recargar */
      },
    });
  }
}
