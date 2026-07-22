import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, debounceTime, of, startWith, switchMap } from 'rxjs';
import { AdminApi } from '../../core/api/admin.api';
import { NotificationsApi } from '../../core/api/notifications.api';
import { ToastService } from '../../core/ui/toast.service';
import { BackLinkComponent } from '../../shared/ui/back-link.component';
import { ConfirmController } from '../../shared/confirm-dialog/confirm-controller';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { IconComponent } from '../../shared/icon/icon.component';
import type { PromoterListItemDto } from '../../core/api/types';

/**
 * Tab de admin (T5): redactar y ENVIAR una notificación a un promotor concreto o a
 * TODOS. Incluye vista previa. El backend audita el envío y hace el fan-out.
 */
@Component({
  selector: 'app-admin-notifications',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TranslatePipe, BackLinkComponent, ConfirmDialogComponent, IconComponent],
  template: `
    <section class="admin-notif">
      <app-back-link link="/configuracion" [label]="'common.backToSettings' | translate" testId="notif-back" />
      <h1>{{ 'notifications.adminSendTitle' | translate }}</h1>
      <p class="muted">{{ 'notifications.adminSendHint' | translate }}</p>

      <form class="notif-form" (ngSubmit)="send()">
        <fieldset class="notif-target">
          <label><input type="radio" name="target" [checked]="!all()" (change)="all.set(false)" data-testid="notif-target-one" /> {{ 'notifications.toOne' | translate }}</label>
          <label><input type="radio" name="target" [checked]="all()" (change)="all.set(true)" data-testid="notif-target-all" /> {{ 'notifications.toAll' | translate }}</label>
        </fieldset>

        @if (!all()) {
          <div class="field notif-combobox">
            <span class="notif-combobox-label">{{ 'notifications.promoter' | translate }}</span>
            <!-- Combobox con buscador: la búsqueda es SERVER-SIDE (debounce); al elegir un
                 promotor se muestra como "chip" con botón para cambiarlo. -->
            @if (selectedPromoter(); as sp) {
              <div class="combobox-selected" data-testid="notif-promoter-selected">
                <span>{{ sp.firstName }} {{ sp.lastName }} — {{ sp.email }}</span>
                <button type="button" class="combobox-clear" (click)="clearPromoter()" [attr.aria-label]="'common.cancel' | translate" data-testid="notif-promoter-clear">
                  <app-icon name="close" [size]="14" />
                </button>
              </div>
            } @else {
              <div class="combobox">
                <span class="combobox-search-ic" aria-hidden="true"><app-icon name="search" [size]="16" /></span>
                <input
                  type="search"
                  [ngModel]="promoterFilter()"
                  (ngModelChange)="onFilter($event)"
                  (focus)="open.set(true)"
                  name="promoterFilter"
                  autocomplete="off"
                  role="combobox"
                  [attr.aria-expanded]="open()"
                  [placeholder]="'notifications.searchPromoter' | translate"
                  data-testid="notif-promoter-search" />
                @if (open()) {
                  <ul class="combobox-list" role="listbox" data-testid="notif-promoter-list">
                    @for (p of filteredPromoters(); track p.id) {
                      <li>
                        <button type="button" role="option" (click)="pickPromoter(p)" [attr.data-testid]="'notif-promoter-opt-' + p.id">
                          <strong>{{ p.firstName }} {{ p.lastName }}</strong>
                          <span class="muted small">{{ p.email }}</span>
                        </button>
                      </li>
                    } @empty {
                      <li class="combobox-empty">{{ 'notifications.noPromoterMatch' | translate }}</li>
                    }
                  </ul>
                }
              </div>
            }
          </div>
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

    @if (confirm.request(); as cf) {
      <app-confirm-dialog
        [title]="cf.title"
        [message]="cf.message"
        [confirmLabel]="cf.confirmLabel ?? ('notifications.send' | translate)"
        [confirmIcon]="cf.confirmIcon ?? 'alert'"
        [danger]="cf.danger ?? false"
        [titleIcon]="cf.titleIcon"
        (accept)="confirm.accept()"
        (cancelled)="confirm.cancel()" />
    }
  `,
  styles: [
    `
      .admin-notif { max-width: 960px; margin: 0 auto; padding: 0 1rem; }
      .notif-form { display: flex; flex-direction: column; gap: 1rem; margin-top: 1rem; }
      /* Control SEGMENTADO (dos opciones) en vez de radios sueltos. */
      .notif-target { display: inline-flex; gap: 0; border: 1px solid var(--pe-border); border-radius: 10px; padding: 0; margin: 0; overflow: hidden; width: fit-content; }
      .notif-target label { display: inline-flex; align-items: center; gap: 0.45rem; padding: 0.55rem 1rem; cursor: pointer; font-size: 0.92rem; }
      .notif-target label + label { border-left: 1px solid var(--pe-border); }
      .notif-target label:has(input:checked) { background: var(--pe-accent-soft); color: var(--pe-accent-strong, var(--pe-accent)); font-weight: 600; }
      .notif-target input { accent-color: var(--pe-accent, #e14eca); }
      .field { display: flex; flex-direction: column; gap: 0.35rem; }
      .notif-preview { border: 1px dashed var(--pe-border); border-radius: var(--pe-radius-sm); padding: 0.8rem 1rem; background: var(--pe-accent-soft); }
      .notif-preview-label { font-size: 0.72rem; text-transform: uppercase; color: var(--pe-text-muted, #6b6b76); }
      .notif-preview p { margin: 0.3rem 0 0; white-space: pre-wrap; }
      /* Combobox de promotor: input con lupa + desplegable de resultados (búsqueda server-side). */
      .notif-combobox { display: flex; flex-direction: column; gap: 0.35rem; }
      .notif-combobox-label { font-size: 0.9rem; }
      .combobox { position: relative; }
      .combobox-search-ic { position: absolute; left: 0.6rem; top: 50%; transform: translateY(-50%); color: var(--pe-text-muted, #6b6b76); pointer-events: none; display: inline-flex; }
      .combobox input { width: 100%; padding: 0.6rem 0.75rem 0.6rem 2.1rem; box-sizing: border-box; }
      .combobox-list {
        position: absolute; z-index: 20; left: 0; right: 0; top: calc(100% + 4px);
        margin: 0; padding: 0.3rem; list-style: none; max-height: 260px; overflow-y: auto;
        background: var(--pe-surface); border: 1px solid var(--pe-border); border-radius: 10px;
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.18);
      }
      .combobox-list li { list-style: none; }
      .combobox-list li button {
        display: flex; flex-direction: column; gap: 0.1rem; width: 100%; text-align: left;
        padding: 0.5rem 0.6rem; border: 0; background: transparent; color: var(--pe-text);
        border-radius: 7px; cursor: pointer;
      }
      .combobox-list li button:hover { background: var(--pe-accent-soft); }
      .combobox-empty { padding: 0.6rem; color: var(--pe-text-muted, #6b6b76); font-size: 0.88rem; }
      .combobox-selected {
        display: flex; align-items: center; justify-content: space-between; gap: 0.6rem;
        padding: 0.55rem 0.75rem; border: 1px solid var(--pe-accent-border, var(--pe-border));
        border-radius: 10px; background: var(--pe-accent-soft);
      }
      .combobox-clear {
        flex: none; display: inline-flex; align-items: center; justify-content: center;
        width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--pe-border);
        background: var(--pe-surface); color: var(--pe-text-muted, #6b6b76); cursor: pointer;
      }
      .combobox-clear:hover { color: var(--pe-danger, #e14eca); border-color: var(--pe-danger, currentColor); }
    `,
  ],
})
export class AdminNotificationsPage {
  private readonly admin = inject(AdminApi);
  private readonly notifications = inject(NotificationsApi);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected readonly promoterFilter = signal('');
  /** Búsqueda de promotores SERVER-SIDE (debounce): no carga todos en el cliente. */
  protected readonly filteredPromoters = toSignal(
    toObservable(this.promoterFilter).pipe(
      debounceTime(250),
      startWith(''),
      switchMap((term) =>
        this.admin
          .listPromoters('approved', term.trim() || undefined, 20)
          .pipe(catchError(() => of([] as PromoterListItemDto[]))),
      ),
    ),
    { initialValue: [] as PromoterListItemDto[] },
  );
  protected readonly all = signal(false);
  protected readonly promoterId = signal('');
  /** Combobox: promotor elegido (para el "chip") y si el desplegable está abierto. */
  protected readonly selectedPromoter = signal<PromoterListItemDto | null>(null);
  protected readonly open = signal(false);
  protected readonly title = signal('');
  protected readonly body = signal('');
  protected readonly working = signal(false);
  protected readonly confirm = new ConfirmController();

  protected readonly canSend = computed(
    () => this.title().trim().length >= 2 && this.body().trim().length >= 1 && (this.all() || !!this.promoterId()),
  );

  /** Escribe en el buscador → abre el desplegable y dispara la búsqueda server-side. */
  protected onFilter(term: string): void {
    this.promoterFilter.set(term);
    this.open.set(true);
  }
  /** Elige un promotor del desplegable (lo fija como destinatario y cierra). */
  protected pickPromoter(p: PromoterListItemDto): void {
    this.selectedPromoter.set(p);
    this.promoterId.set(p.id);
    this.open.set(false);
  }
  /** Quita el promotor elegido para volver a buscar. */
  protected clearPromoter(): void {
    this.selectedPromoter.set(null);
    this.promoterId.set('');
    this.promoterFilter.set('');
    this.open.set(true);
  }
  /** Cierra el desplegable al hacer clic fuera del combobox. */
  @HostListener('document:click', ['$event'])
  protected onDocClick(ev: MouseEvent): void {
    if (!this.open()) return;
    const el = ev.target as HTMLElement;
    if (!el.closest('.notif-combobox')) this.open.set(false);
  }

  protected send(): void {
    if (!this.canSend() || this.working()) return;
    // Broadcast a TODOS los promotores: fan-out masivo e irreversible → confirmar antes.
    if (this.all()) {
      this.confirm.ask({
        title: this.translate.instant('notifications.confirmAllTitle'),
        message: this.translate.instant('notifications.confirmAllMsg'),
        confirmLabel: this.translate.instant('notifications.confirmAllOk'),
        confirmIcon: 'alert',
        danger: true,
        onConfirm: () => this.doSend(),
      });
      return;
    }
    this.doSend();
  }

  private doSend(): void {
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
        this.selectedPromoter.set(null);
        this.promoterFilter.set('');
      },
      error: () => {
        this.working.set(false);
        this.toasts.error(this.translate.instant('notifications.sendError'));
      },
    });
  }
}
