import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AdvisorInvitationsApi, type AdvisorInvitationRow } from '../../core/api/advisor-invitations.api';
import { AdvisorsApi, type AdvisorRow } from '../../core/api/advisors.api';
import { AdvisorApi, type AdvisorUnlockState } from '../../core/api/advisor.api';
import { ToastService } from '../../core/ui/toast.service';
import { BackLinkComponent } from '../../shared/ui/back-link.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { StatusLabelPipe } from '../../shared/ui/status-label.pipe';
import { LocalizedDatePipe } from '../../core/i18n/localized-date.pipe';
import { IconComponent } from '../../shared/icon/icon.component';
import { ConfirmController } from '../../shared/confirm-dialog/confirm-controller';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';

/**
 * Admin (T7e): invitar ASESORES por correo y ver el estado de las invitaciones.
 * El backend crea el usuario si no existe y envía el link (confirmar / fijar password).
 */
@Component({
  selector: 'app-admin-advisors',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslatePipe, BackLinkComponent, EmptyStateComponent, StatusLabelPipe, LocalizedDatePipe, IconComponent, ConfirmDialogComponent],
  template: `
    <section class="admin-advisors">
      <app-back-link link="/configuracion" [label]="'common.backToSettings' | translate" testId="adv-back" />
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
      } @else if (loading()) {
        <p class="muted" data-testid="adv-loading">{{ 'common.loading' | translate }}</p>
      } @else if (loadError()) {
        <p class="muted" role="alert" data-testid="adv-error">{{ 'advisor.admin.loadError' | translate }}</p>
      } @else {
        <app-empty-state variant="generic" data-testid="adv-empty"
          [title]="'advisor.admin.emptyTitle' | translate"
          [subtitle]="'advisor.admin.emptyBody' | translate" />
      }

      <!-- Gestión de asesores actuales: deshabilitar (→ cliente) / habilitar / notificar / eliminar / desbloquear. -->
      <div class="adv-mgmt-head">
        <h2 class="adv-mgmt-title">{{ 'advisor.admin.manageTitle' | translate }}</h2>
        <button type="button" class="btn small subtle" (click)="refreshAdvisors()" [disabled]="refreshing()" data-testid="adv-refresh">
          <app-icon name="reactivate" [size]="15" /> {{ refreshing() ? ('common.loading' | translate) : ('advisor.admin.refresh' | translate) }}
        </button>
      </div>
      @if (advisors().length > 0) {
        <ul class="adv-list" data-testid="adv-mgmt-list">
          @for (a of advisors(); track a.id) {
            <li class="adv-row" [class.is-disabled]="a.disabled">
              <span class="adv-email">{{ a.firstName || a.email }}<span class="muted small"> · {{ a.email }}</span></span>
              @if (a.disabled) {
                <span class="badge badge-inactive">{{ 'advisor.admin.disabledBadge' | translate }}</span>
              } @else {
                <span class="badge badge-active">{{ 'advisor.admin.activeBadge' | translate }}</span>
                @if (unlockLabel(a.id) === 'active') {
                  <span class="badge badge-active" [title]="'advisor.admin.unlockUntil' | translate: { time: (unlockExpiresAt(a.id) | localizedDate: 'short') }" [attr.data-testid]="'adv-unlock-active-' + a.id">
                    <app-icon name="unlock" [size]="13" /> {{ 'advisor.admin.unlockActive' | translate }}
                  </span>
                } @else if (unlockLabel(a.id) === 'pending') {
                  <span class="badge badge-pending" [attr.data-testid]="'adv-unlock-pending-' + a.id">{{ 'advisor.admin.unlockPending' | translate }}</span>
                }
              }
              <div class="adv-actions">
                @if (a.disabled) {
                  <button type="button" class="btn small success" (click)="enable(a)" [attr.data-testid]="'adv-enable-' + a.id"><app-icon name="reactivate" [size]="15" /> {{ 'advisor.admin.enable' | translate }}</button>
                  <button type="button" class="btn small danger" (click)="askRemove(a)" [attr.data-testid]="'adv-remove-' + a.id"><app-icon name="delete" [size]="15" /> {{ 'advisor.admin.remove' | translate }}</button>
                } @else {
                  @if (unlockLabel(a.id) !== 'active') {
                    <button type="button" class="btn small" [class.success]="unlockLabel(a.id) === 'pending'" [class.subtle]="unlockLabel(a.id) !== 'pending'" (click)="askGrant(a)" [attr.data-testid]="'adv-grant-' + a.id"><app-icon name="unlock" [size]="15" /> {{ 'advisor.admin.grant' | translate }}</button>
                  }
                  <button type="button" class="btn small subtle" (click)="askNotify(a)" [attr.data-testid]="'adv-notify-' + a.id"><app-icon name="bell" [size]="15" /> {{ 'advisor.admin.notify' | translate }}</button>
                  <button type="button" class="btn small subtle" (click)="askDisable(a)" [attr.data-testid]="'adv-disable-' + a.id"><app-icon name="suspend" [size]="15" /> {{ 'advisor.admin.disable' | translate }}</button>
                }
              </div>
            </li>
          }
        </ul>
      } @else {
        <p class="muted" data-testid="adv-mgmt-empty">{{ 'advisor.admin.mgmtEmpty' | translate }}</p>
      }
    </section>

    @if (confirm.request(); as cf) {
      <app-confirm-dialog
        [title]="cf.title" [message]="cf.message"
        [confirmLabel]="cf.confirmLabel ?? ('common.confirm' | translate)"
        [confirmIcon]="cf.confirmIcon ?? 'alert'" [danger]="cf.danger ?? false"
        (accept)="confirm.accept()" (cancelled)="confirm.cancel()" />
    }
  `,
  styles: [
    `
      .admin-advisors { max-width: 960px; margin: 0 auto; padding: 0 1rem; }
      .adv-invite-form { display: flex; gap: 0.6rem; align-items: flex-end; margin: 1rem 0; flex-wrap: wrap; }
      .adv-invite-form .field { flex: 1 1 240px; display: flex; flex-direction: column; gap: 0.3rem; }
      /* Input y botón a la MISMA altura → el botón queda alineado con el input (no arriba). */
      .adv-invite-form input { height: 42px; box-sizing: border-box; padding: 0 0.75rem; border: 1px solid var(--pe-border); border-radius: 8px; background: var(--pe-surface); color: var(--pe-text); }
      .adv-invite-form .btn { height: 42px; }
      .adv-list { list-style: none; padding: 0; margin: 1rem 0 0; display: flex; flex-direction: column; gap: 0.4rem; }
      .adv-row { display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.8rem; border: 1px solid var(--pe-border); border-radius: var(--pe-radius-sm); }
      .adv-email { font-weight: 600; }
      .adv-row time { margin-left: auto; }
      .adv-mgmt-head { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; margin: 1.8rem 0 0.6rem; flex-wrap: wrap; }
      .adv-mgmt-title { margin: 0; font-size: 1.1rem; }
      .adv-row.is-disabled { opacity: 0.75; }
      .adv-actions { margin-left: auto; display: flex; gap: 0.4rem; flex-wrap: wrap; }
    `,
  ],
})
export class AdminAdvisorsPage {
  private readonly api = inject(AdvisorInvitationsApi);
  private readonly advisorsApi = inject(AdvisorsApi);
  private readonly advisorApi = inject(AdvisorApi);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);
  protected readonly confirm = new ConfirmController();

  protected readonly emails = signal('');
  protected readonly rows = signal<AdvisorInvitationRow[]>([]);
  protected readonly advisors = signal<AdvisorRow[]>([]);
  protected readonly unlockStates = signal<AdvisorUnlockState[]>([]);
  protected readonly working = signal(false);
  protected readonly loading = signal(false);
  protected readonly loadError = signal(false);
  protected readonly refreshing = signal(false);
  protected readonly canInvite = computed(() => this.emails().trim().length > 3);

  /** Estado de desbloqueo indexado por asesor (O(1) en la plantilla). */
  private readonly unlockMap = computed(() => {
    const m = new Map<string, AdvisorUnlockState>();
    for (const s of this.unlockStates()) m.set(s.advisorId, s);
    return m;
  });

  constructor() {
    this.reload();
    this.reloadAdvisors();
  }

  /** Recarga la lista de asesores Y sus estados de desbloqueo (una pasada, sin socket). */
  private reloadAdvisors(): void {
    forkJoin({
      advisors: this.advisorsApi.list().pipe(catchError(() => of([] as AdvisorRow[]))),
      unlocks: this.advisorApi.listPending().pipe(catchError(() => of([] as AdvisorUnlockState[]))),
    }).subscribe(({ advisors, unlocks }) => {
      this.advisors.set(advisors);
      this.unlockStates.set(unlocks);
    });
  }

  /** Botón "Actualizar": recarga a demanda (el usuario pidió refresco manual, sin socket). */
  protected refreshAdvisors(): void {
    this.refreshing.set(true);
    forkJoin({
      advisors: this.advisorsApi.list().pipe(catchError(() => of([] as AdvisorRow[]))),
      unlocks: this.advisorApi.listPending().pipe(catchError(() => of([] as AdvisorUnlockState[]))),
    }).subscribe(({ advisors, unlocks }) => {
      this.advisors.set(advisors);
      this.unlockStates.set(unlocks);
      this.refreshing.set(false);
      this.toasts.info(this.t('advisor.admin.refreshedOk'));
    });
  }

  /** Estado de desbloqueo de un asesor para la plantilla: 'active' | 'pending' | 'none'. */
  protected unlockLabel(id: string): 'active' | 'pending' | 'none' {
    const s = this.unlockMap().get(id);
    if (!s) return 'none';
    if (s.unlocked) return 'active';
    if (s.pending) return 'pending';
    return 'none';
  }

  protected unlockExpiresAt(id: string): string | null {
    return this.unlockMap().get(id)?.expiresAt ?? null;
  }

  /** El admin concede el desbloqueo directamente (F3): confirma → abre la ventana → recarga. */
  protected askGrant(a: AdvisorRow): void {
    this.confirm.ask({
      title: this.t('advisor.admin.grantTitle'),
      message: this.t('advisor.admin.grantMsg', { name: a.firstName || a.email }),
      confirmLabel: this.t('advisor.admin.grant'),
      confirmIcon: 'unlock',
      onConfirm: () =>
        this.advisorApi.grant(a.id).subscribe({
          next: () => {
            this.toasts.success(this.t('advisor.admin.grantedOk'));
            this.reloadAdvisors();
          },
          error: () => this.toasts.error(this.t('advisor.admin.actionError')),
        }),
    });
  }

  private t(k: string, p?: Record<string, unknown>): string {
    return this.translate.instant(k, p);
  }

  protected askDisable(a: AdvisorRow): void {
    this.confirm.ask({
      title: this.t('advisor.admin.disableTitle'),
      message: this.t('advisor.admin.disableMsg', { name: a.firstName || a.email }),
      confirmLabel: this.t('advisor.admin.disable'),
      confirmIcon: 'suspend',
      danger: true,
      onConfirm: () =>
        this.advisorsApi.disable(a.id).subscribe({
          next: () => { this.toasts.success(this.t('advisor.admin.disabledOk')); this.reloadAdvisors(); },
          error: () => this.toasts.error(this.t('advisor.admin.actionError')),
        }),
    });
  }

  protected enable(a: AdvisorRow): void {
    this.advisorsApi.enable(a.id).subscribe({
      next: () => { this.toasts.success(this.t('advisor.admin.enabledOk')); this.reloadAdvisors(); },
      error: () => this.toasts.error(this.t('advisor.admin.actionError')),
    });
  }

  protected askRemove(a: AdvisorRow): void {
    this.confirm.ask({
      title: this.t('advisor.admin.removeTitle'),
      message: this.t('advisor.admin.removeMsg', { name: a.firstName || a.email }),
      confirmLabel: this.t('advisor.admin.remove'),
      confirmIcon: 'delete',
      danger: true,
      onConfirm: () =>
        this.advisorsApi.remove(a.id).subscribe({
          next: () => { this.toasts.success(this.t('advisor.admin.removedOk')); this.reloadAdvisors(); },
          error: () => this.toasts.error(this.t('advisor.admin.actionError')),
        }),
    });
  }

  protected askNotify(a: AdvisorRow): void {
    const body = typeof window !== 'undefined' ? window.prompt(this.t('advisor.admin.notifyPrompt')) : null;
    if (!body?.trim()) return;
    this.advisorsApi.notify(a.id, this.t('advisor.admin.notifyTitle'), body.trim()).subscribe({
      next: () => this.toasts.success(this.t('advisor.admin.notifiedOk')),
      error: () => this.toasts.error(this.t('advisor.admin.actionError')),
    });
  }

  private reload(): void {
    this.loading.set(true);
    this.loadError.set(false);
    this.api.list().subscribe({
      next: (r) => {
        this.rows.set(r);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set(true);
      },
    });
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
