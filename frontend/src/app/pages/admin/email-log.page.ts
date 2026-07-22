import { ChangeDetectionStrategy, Component, PLATFORM_ID, inject, input, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { EmailLogApi, EmailLogFilters, EmailLogItem } from '../../core/api/email-log.api';
import { LocalizedDatePipe } from '../../core/i18n/localized-date.pipe';
import { BackLinkComponent } from '../../shared/ui/back-link.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { LoadingComponent } from '../../shared/ui/loading.component';

/**
 * Registro de correos enviados (admin). Filtros + búsqueda 100% SERVER-SIDE (keyset).
 * Se usa como tab de /configuracion (embedded) o como página propia.
 */
@Component({
  selector: 'app-email-log',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslatePipe, LocalizedDatePipe, BackLinkComponent, EmptyStateComponent, LoadingComponent],
  template: `
    <section class="email-log">
      @if (!embedded()) {
        <app-back-link link="/configuracion" [label]="'common.backToSettings' | translate" testId="elog-back" />
        <h1>{{ 'emailLog.title' | translate }}</h1>
      }
      <p class="muted">{{ 'emailLog.hint' | translate }}</p>

      <div class="elog-filters">
        <input type="search" [ngModel]="search()" (ngModelChange)="onSearch($event)" name="elog-search"
          [placeholder]="'emailLog.searchPlaceholder' | translate" data-testid="elog-search" />
        <select [ngModel]="status()" (ngModelChange)="onFilter('status', $event)" name="elog-status" data-testid="elog-status">
          <option value="">{{ 'emailLog.allStatuses' | translate }}</option>
          <option value="sent">{{ 'emailLog.status_sent' | translate }}</option>
          <option value="queued">{{ 'emailLog.status_queued' | translate }}</option>
          <option value="failed">{{ 'emailLog.status_failed' | translate }}</option>
        </select>
        <input type="text" [ngModel]="type()" (ngModelChange)="onFilter('type', $event)" name="elog-type"
          [placeholder]="'emailLog.typePlaceholder' | translate" data-testid="elog-type" />
        <label class="elog-date"><span>{{ 'emailLog.from' | translate }}</span>
          <input type="date" [ngModel]="from()" (ngModelChange)="onFilter('from', $event)" name="elog-from" /></label>
        <label class="elog-date"><span>{{ 'emailLog.to' | translate }}</span>
          <input type="date" [ngModel]="to()" (ngModelChange)="onFilter('to', $event)" name="elog-to" /></label>
      </div>

      @if (loading() && items().length === 0) {
        <app-loading [label]="'common.loading' | translate" />
      } @else if (errored()) {
        <app-empty-state variant="generic" [title]="'common.errorLoading' | translate" [subtitle]="'emailLog.error' | translate" />
      } @else if (items().length === 0) {
        <app-empty-state variant="generic" [title]="'emailLog.emptyTitle' | translate" [subtitle]="'emailLog.emptyBody' | translate" />
      } @else {
        <div class="elog-table-wrap">
          <table class="elog-table" data-testid="elog-table">
            <thead>
              <tr>
                <th>{{ 'emailLog.colDate' | translate }}</th>
                <th>{{ 'emailLog.colRecipient' | translate }}</th>
                <th>{{ 'emailLog.colType' | translate }}</th>
                <th>{{ 'emailLog.colSubject' | translate }}</th>
                <th>{{ 'emailLog.colStatus' | translate }}</th>
              </tr>
            </thead>
            <tbody>
              @for (r of items(); track r.id) {
                <tr>
                  <td class="muted small">{{ r.createdAt | localizedDate: 'short' }}</td>
                  <td>{{ r.recipient }}</td>
                  <td><code class="elog-type">{{ r.type }}</code></td>
                  <td>{{ r.subject }}</td>
                  <td>
                    <span class="elog-badge elog-{{ r.status }}">{{ ('emailLog.status_' + r.status) | translate }}</span>
                    @if (r.error) { <span class="muted small" [title]="r.error"> · {{ r.error }}</span> }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (nextCursor()) {
          <button type="button" class="btn small btn-block" (click)="loadMore()" [disabled]="loading()" data-testid="elog-more">
            {{ 'common.loadMore' | translate }}
          </button>
        }
      }
    </section>
  `,
  styles: [
    `
      .email-log { max-width: 1000px; margin: 0 auto; padding: 0 1rem; }
      .elog-filters { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: flex-end; margin: 1rem 0; }
      .elog-filters input[type='search'], .elog-filters input[type='text'], .elog-filters select { padding: 0.5rem 0.6rem; }
      .elog-date { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.78rem; color: var(--pe-text-muted); }
      .elog-table-wrap { overflow-x: auto; }
      .elog-table { width: 100%; border-collapse: collapse; }
      .elog-table th, .elog-table td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--pe-border); font-size: 0.9rem; }
      .elog-table th { color: var(--pe-text-muted); font-weight: 600; }
      .elog-type { font-size: 0.75rem; color: var(--pe-text-muted); }
      .elog-badge { display: inline-flex; padding: 0.15rem 0.5rem; border-radius: 999px; font-size: 0.72rem; font-weight: 700; border: 1px solid var(--pe-border); }
      .elog-sent { background: var(--pe-success-soft, rgba(16,185,129,0.14)); color: var(--pe-success-strong, #047857); }
      .elog-queued { background: var(--pe-accent-soft); color: var(--pe-accent-strong, var(--pe-accent)); }
      .elog-failed { background: var(--pe-danger-soft, rgba(220,38,38,0.14)); color: var(--pe-danger-strong, #b91c1c); }
    `,
  ],
})
export class EmailLogPage {
  private readonly api = inject(EmailLogApi);
  private readonly platformId = inject(PLATFORM_ID);
  readonly embedded = input(false);

  protected readonly items = signal<EmailLogItem[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly errored = signal(false);
  protected readonly search = signal('');
  protected readonly status = signal('');
  protected readonly type = signal('');
  protected readonly from = signal('');
  protected readonly to = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (isPlatformBrowser(this.platformId)) this.reload();
  }

  private filters(cursor?: string): EmailLogFilters {
    return {
      search: this.search() || undefined,
      status: this.status() || undefined,
      type: this.type() || undefined,
      from: this.from() || undefined,
      to: this.to() || undefined,
      cursor,
    };
  }

  private reload(): void {
    this.loading.set(true);
    this.errored.set(false);
    this.api.list(this.filters()).subscribe({
      next: (p) => {
        this.items.set(p.items);
        this.nextCursor.set(p.nextCursor);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.errored.set(true);
      },
    });
  }

  protected loadMore(): void {
    const cursor = this.nextCursor();
    if (!cursor || this.loading()) return;
    this.loading.set(true);
    this.api.list(this.filters(cursor)).subscribe({
      next: (p) => {
        this.items.update((cur) => [...cur, ...p.items]);
        this.nextCursor.set(p.nextCursor);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected onFilter(key: 'status' | 'type' | 'from' | 'to', value: string): void {
    ({ status: this.status, type: this.type, from: this.from, to: this.to })[key].set(value);
    this.reload();
  }

  /** Búsqueda con debounce (server-side). */
  protected onSearch(value: string): void {
    this.search.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.reload(), 300);
  }
}
