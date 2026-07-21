import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AdvisorInvitationsApi, type AdvisorInvitationRow } from '../../core/api/advisor-invitations.api';
import { ToastService } from '../../core/ui/toast.service';
import { BackLinkComponent } from '../../shared/ui/back-link.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { StatusLabelPipe } from '../../shared/ui/status-label.pipe';
import { LocalizedDatePipe } from '../../core/i18n/localized-date.pipe';

/**
 * Admin (T7e): invitar ASESORES por correo y ver el estado de las invitaciones.
 * El backend crea el usuario si no existe y envía el link (confirmar / fijar password).
 */
@Component({
  selector: 'app-admin-advisors',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslatePipe, BackLinkComponent, EmptyStateComponent, StatusLabelPipe, LocalizedDatePipe],
  template: `
    <section class="admin-advisors">
      <app-back-link link="/configuracion" [label]="'advisor.admin.back' | translate" testId="adv-back" />
      <h1>{{ 'advisor.admin.title' | translate }}</h1>
      <p class="muted">{{ 'advisor.admin.hint' | translate }}</p>

      <form class="adv-invite-form" (ngSubmit)="invite()">
        <label class="field">
          <span>{{ 'advisor.admin.emails' | translate }}</span>
          <input [(ngModel)]="emails" name="emails" [placeholder]="'advisor.admin.emailsPlaceholder' | translate" data-testid="adv-emails" />
        </label>
        <button type="submit" class="btn primary" [disabled]="!canInvite() || working()" data-testid="adv-invite">
          {{ working() ? ('common.sending' | translate) : ('advisor.admin.invite' | translate) }}
        </button>
      </form>

      @if (rows().length > 0) {
        <ul class="adv-list" data-testid="adv-list">
          @for (r of rows(); track r.id) {
            <li class="adv-row">
              <span class="adv-email">{{ r.email }}</span>
              <span class="badge badge-{{ r.status }}">{{ r.status | statusLabel }}</span>
              <time class="muted small">{{ r.createdAt | localizedDate: 'short' }}</time>
            </li>
          }
        </ul>
      } @else {
        <app-empty-state variant="generic" data-testid="adv-empty"
          [title]="'advisor.admin.emptyTitle' | translate"
          [subtitle]="'advisor.admin.emptyBody' | translate" />
      }
    </section>
  `,
  styles: [
    `
      .admin-advisors { max-width: 640px; margin: 0 auto; }
      .adv-invite-form { display: flex; gap: 0.6rem; align-items: flex-end; margin: 1rem 0; flex-wrap: wrap; }
      .adv-invite-form .field { flex: 1 1 240px; display: flex; flex-direction: column; gap: 0.3rem; }
      .adv-list { list-style: none; padding: 0; margin: 1rem 0 0; display: flex; flex-direction: column; gap: 0.4rem; }
      .adv-row { display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.8rem; border: 1px solid var(--pe-border); border-radius: var(--pe-radius-sm); }
      .adv-email { font-weight: 600; }
      .adv-row time { margin-left: auto; }
    `,
  ],
})
export class AdminAdvisorsPage {
  private readonly api = inject(AdvisorInvitationsApi);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected readonly emails = signal('');
  protected readonly rows = signal<AdvisorInvitationRow[]>([]);
  protected readonly working = signal(false);
  protected readonly canInvite = computed(() => this.emails().trim().length > 3);

  constructor() {
    this.reload();
  }

  private reload(): void {
    this.api.list().subscribe({ next: (r) => this.rows.set(r), error: () => undefined });
  }

  protected invite(): void {
    if (!this.canInvite() || this.working()) return;
    const list = this.emails()
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    this.working.set(true);
    this.api.create(list).subscribe({
      next: (res) => {
        this.working.set(false);
        this.emails.set('');
        this.toasts.success(this.translate.instant('advisor.admin.sent', { n: res.invitations.length }));
        this.reload();
      },
      error: () => {
        this.working.set(false);
        this.toasts.error(this.translate.instant('advisor.admin.error'));
      },
    });
  }
}
