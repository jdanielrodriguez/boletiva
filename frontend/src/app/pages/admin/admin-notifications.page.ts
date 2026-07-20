import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AdminApi } from '../../core/api/admin.api';
import { NotificationsApi } from '../../core/api/notifications.api';
import { ToastService } from '../../core/ui/toast.service';
import { BackLinkComponent } from '../../shared/ui/back-link.component';
import type { PromoterListItemDto } from '../../core/api/types';

/**
 * Tab de admin (T5): redactar y ENVIAR una notificación a un promotor concreto o a
 * TODOS. Incluye vista previa. El backend audita el envío y hace el fan-out.
 */
@Component({
  selector: 'app-admin-notifications',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslatePipe, BackLinkComponent],
  template: `
    <section class="admin-notif">
      <app-back-link link="/configuracion" [label]="'notifications.back' | translate" testId="notif-back" />
      <h1>{{ 'notifications.adminSendTitle' | translate }}</h1>
      <p class="muted">{{ 'notifications.adminSendHint' | translate }}</p>

      <form class="notif-form" (ngSubmit)="send()">
        <fieldset class="notif-target">
          <label><input type="radio" name="target" [checked]="!all()" (change)="all.set(false)" data-testid="notif-target-one" /> {{ 'notifications.toOne' | translate }}</label>
          <label><input type="radio" name="target" [checked]="all()" (change)="all.set(true)" data-testid="notif-target-all" /> {{ 'notifications.toAll' | translate }}</label>
        </fieldset>

        @if (!all()) {
          <label class="field">
            <span>{{ 'notifications.promoter' | translate }}</span>
            <select [(ngModel)]="promoterId" name="promoter" data-testid="notif-promoter" required>
              <option value="" disabled>{{ 'notifications.pickPromoter' | translate }}</option>
              @for (p of promoters(); track p.id) {
                <option [value]="p.id">{{ p.firstName }} {{ p.lastName }} — {{ p.email }}</option>
              }
            </select>
          </label>
        }

        <label class="field">
          <span>{{ 'notifications.fieldTitle' | translate }}</span>
          <input [(ngModel)]="title" name="title" maxlength="160" required data-testid="notif-title" />
        </label>
        <label class="field">
          <span>{{ 'notifications.fieldBody' | translate }}</span>
          <textarea [(ngModel)]="body" name="body" rows="5" maxlength="4000" required data-testid="notif-body"></textarea>
        </label>

        @if (title() || body()) {
          <div class="notif-preview" data-testid="notif-preview">
            <span class="notif-preview-label">{{ 'notifications.preview' | translate }}</span>
            <strong>{{ title() }}</strong>
            <p>{{ body() }}</p>
          </div>
        }

        <button type="submit" class="btn primary" [disabled]="!canSend() || working()" data-testid="notif-send">
          {{ working() ? ('common.sending' | translate) : ('notifications.send' | translate) }}
        </button>
      </form>
    </section>
  `,
  styles: [
    `
      .admin-notif { max-width: 640px; margin: 0 auto; }
      .notif-form { display: flex; flex-direction: column; gap: 1rem; margin-top: 1rem; }
      .notif-target { display: flex; gap: 1.2rem; border: none; padding: 0; }
      .notif-target label { display: inline-flex; align-items: center; gap: 0.4rem; }
      .field { display: flex; flex-direction: column; gap: 0.35rem; }
      .notif-preview { border: 1px dashed var(--pe-border); border-radius: var(--pe-radius-sm); padding: 0.8rem 1rem; background: var(--pe-accent-soft); }
      .notif-preview-label { font-size: 0.72rem; text-transform: uppercase; color: var(--pe-text-muted, #6b6b76); }
      .notif-preview p { margin: 0.3rem 0 0; white-space: pre-wrap; }
    `,
  ],
})
export class AdminNotificationsPage {
  private readonly admin = inject(AdminApi);
  private readonly notifications = inject(NotificationsApi);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected readonly promoters = signal<PromoterListItemDto[]>([]);
  protected readonly all = signal(false);
  protected readonly promoterId = signal('');
  protected readonly title = signal('');
  protected readonly body = signal('');
  protected readonly working = signal(false);

  protected readonly canSend = computed(
    () => this.title().trim().length >= 2 && this.body().trim().length >= 1 && (this.all() || !!this.promoterId()),
  );

  constructor() {
    this.admin.listPromoters('approved').subscribe({ next: (p) => this.promoters.set(p), error: () => undefined });
  }

  protected send(): void {
    if (!this.canSend() || this.working()) return;
    this.working.set(true);
    const payload = this.all()
      ? { all: true, title: this.title().trim(), body: this.body().trim() }
      : { promoterId: this.promoterId(), title: this.title().trim(), body: this.body().trim() };
    this.notifications.adminSend(payload).subscribe({
      next: (r) => {
        this.working.set(false);
        this.toasts.success(this.translate.instant('notifications.sent', { n: r.sent }));
        this.title.set('');
        this.body.set('');
        this.promoterId.set('');
      },
      error: () => {
        this.working.set(false);
        this.toasts.error(this.translate.instant('notifications.sendError'));
      },
    });
  }
}
