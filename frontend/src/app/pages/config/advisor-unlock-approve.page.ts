import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { LocalizedDatePipe } from '../../core/i18n/localized-date.pipe';
import { AdvisorApi } from '../../core/api/advisor.api';

/**
 * B2 · Página a la que llega el ADMIN desde el enlace del correo para APROBAR el
 * desbloqueo temporal de un asesor. Toma `?token=` pero NO aprueba al cargar (QA): exige
 * un CLICK explícito de confirmación → abrir la ventana de edición de admin es un acto
 * consciente, no algo que dispare un prefetch/escáner de correo al abrir la URL.
 */
@Component({
  selector: 'app-advisor-unlock-approve',
  imports: [TranslatePipe, RouterLink, LocalizedDatePipe],
  template: `
    <section class="auth-card">
      <h1>{{ 'advisor.approveTitle' | translate }}</h1>
      @switch (state()) {
        @case ('confirm') {
          <p class="muted" data-testid="adv-confirm">{{ 'advisor.approveConfirm' | translate }}</p>
          <button type="button" class="btn primary" data-testid="adv-authorize" (click)="authorize()">
            {{ 'advisor.authorizeBtn' | translate }}
          </button>
        }
        @case ('loading') {
          <p class="muted" data-testid="adv-loading">{{ 'advisor.approving' | translate }}</p>
        }
        @case ('ok') {
          <p class="ok" data-testid="adv-ok">
            {{ 'advisor.approved' | translate }}
            @if (expiresAt()) {
              <br />{{ 'advisor.approvedUntil' | translate: { time: (expiresAt() | localizedDate: 'HH:mm') } }}
            }
          </p>
        }
        @case ('error') {
          <p class="error" role="alert" data-testid="adv-error">{{ 'advisor.approveError' | translate }}</p>
        }
      }
      <a class="btn btn-outline" routerLink="/configuracion">{{ 'advisor.backToConsole' | translate }}</a>
    </section>
  `,
  styles: [
    `
      .ok {
        color: var(--pe-success);
        font-weight: 600;
        padding: 0.6rem 0.9rem;
        border-radius: var(--pe-radius);
        background: var(--pe-success-soft, transparent);
        border: 1px solid var(--pe-success-border, transparent);
      }
      .error {
        color: var(--pe-danger);
        font-weight: 600;
        padding: 0.6rem 0.9rem;
        border-radius: var(--pe-radius);
        background: var(--pe-danger-soft, transparent);
        border: 1px solid var(--pe-danger-border, transparent);
      }
    `,
  ],
})
export class AdvisorUnlockApprovePage {
  private readonly route = inject(ActivatedRoute);
  private readonly advisor = inject(AdvisorApi);
  protected readonly state = signal<'confirm' | 'loading' | 'ok' | 'error'>('confirm');
  protected readonly expiresAt = signal<string | null>(null);
  private readonly token = this.route.snapshot.queryParamMap.get('token');

  constructor() {
    // Sin token → error directo; con token, ESPERA el click (no auto-aprueba).
    if (!this.token) this.state.set('error');
  }

  /** Solo tras el click consciente del admin se abre la ventana de desbloqueo. */
  protected authorize(): void {
    if (!this.token) return;
    this.state.set('loading');
    this.advisor.approve(this.token).subscribe({
      next: (r) => {
        this.expiresAt.set(r.expiresAt);
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
  }
}
