import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { LocalizedDatePipe } from '../../core/i18n/localized-date.pipe';
import { AdvisorApi } from '../../core/api/advisor.api';

/**
 * B2 · Página a la que llega el ADMIN desde el enlace del correo para APROBAR el
 * desbloqueo temporal de un asesor. Toma `?token=` y llama al backend (admin-only).
 */
@Component({
  selector: 'app-advisor-unlock-approve',
  imports: [TranslatePipe, RouterLink, LocalizedDatePipe],
  template: `
    <section class="auth-card">
      <h1>{{ 'advisor.approveTitle' | translate }}</h1>
      @switch (state()) {
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
          <p class="error" data-testid="adv-error">{{ 'advisor.approveError' | translate }}</p>
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
  protected readonly state = signal<'loading' | 'ok' | 'error'>('loading');
  protected readonly expiresAt = signal<string | null>(null);

  constructor() {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.state.set('error');
      return;
    }
    this.advisor.approve(token).subscribe({
      next: (r) => {
        this.expiresAt.set(r.expiresAt);
        this.state.set('ok');
      },
      error: () => this.state.set('error'),
    });
  }
}
