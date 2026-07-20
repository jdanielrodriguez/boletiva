import { HttpClient } from '@angular/common/http';
import { Component, Injector, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuditApi } from '../../core/api/audit.api';
import { TicketsApi } from '../../core/api/tickets.api';
import { SITE_URL } from '../../core/config/api.tokens';
import { ToastService } from '../../core/ui/toast.service';

/** Paso del asistente de transferencia. */
type Step = 'info' | 'share';

/**
 * Asistente de transferencia de boleto (v3.8/G3) — regalo interno por código.
 * Dos pasos amigables:
 *  1. INFO: explica qué es transferir (regalo, el boleto original queda
 *     inservible al re-emitirse al nuevo dueño) y pide confirmar.
 *  2. COMPARTIR: al confirmar se llama `POST /tickets/:id/transfer`, que devuelve
 *     el código (una sola vez). Ofrece copiarlo o compartirlo por correo, y
 *     explica que el destinatario lo pega en "Reclamar boleto" para importarlo.
 * El click de confirmación se registra en la bitácora de auditoría (no-repudio)
 * cuando hay HttpClient disponible (siempre en la app real).
 */
@Component({
  selector: 'app-ticket-transfer-modal',
  imports: [FormsModule, TranslatePipe],
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <div class="modal-backdrop" data-testid="transfer-modal">
      <div class="modal-card transfer-modal" role="dialog" aria-modal="true" aria-labelledby="tt-title">
        @if (step() === 'info') {
          <div class="tt-head">
            <span class="tt-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.7l6.8-4M8.6 13.3l6.8 4" stroke-linecap="round"/></svg>
            </span>
            <h2 id="tt-title">{{ 'transfer.modal.infoTitle' | translate }}</h2>
          </div>
          @if (serial()) {
            <p class="tt-serial">{{ 'transfer.modal.ticketSerial' | translate: { serial: serial() } }}</p>
          }
          <ul class="tt-points">
            <li>{{ 'transfer.modal.point1' | translate }}</li>
            <li>{{ 'transfer.modal.point2' | translate }}</li>
            <li>{{ 'transfer.modal.point3' | translate }}</li>
            <li>{{ 'transfer.modal.point4' | translate }}</li>
          </ul>
          @if (error()) {
            <p class="error" data-testid="transfer-error">{{ error() }}</p>
          }
          <div class="ev-card-actions confirm-actions">
            <button type="button" class="btn primary" data-testid="transfer-confirm" [disabled]="working()" (click)="confirm()">
              {{ working() ? ('transfer.modal.sending' | translate) : ('transfer.modal.confirmYes' | translate) }}
            </button>
            <button type="button" class="btn" data-testid="transfer-cancel" [disabled]="working()" (click)="closed.emit()">
              {{ 'common.cancel' | translate }}
            </button>
          </div>
        } @else {
          <div class="tt-head">
            <span class="tt-icon ok" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M8 12.5l2.5 2.5L16 9" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            <h2 id="tt-title">{{ 'transfer.modal.shareTitle' | translate }}</h2>
          </div>
          <p class="tt-share-lead">{{ 'transfer.modal.shareLead' | translate }}</p>

          <div class="tt-code" data-testid="transfer-code">
            <code>{{ code() }}</code>
            <button type="button" class="btn sm" data-testid="transfer-copy" (click)="copy()" [attr.aria-label]="'transfer.modal.copyCode' | translate">
              {{ (copied() ? 'common.copied' : 'common.copy') | translate }}
            </button>
          </div>

          <div class="tt-email">
            <label for="tt-email-input">{{ 'transfer.modal.emailLabel' | translate }}</label>
            <div class="tt-email-row">
              <input
                id="tt-email-input"
                type="email"
                autocomplete="email"
                [attr.placeholder]="'transfer.modal.emailPlaceholder' | translate"
                [ngModel]="email()"
                (ngModelChange)="email.set($event)"
                data-testid="transfer-email"
              />
              <a
                class="btn"
                [class.disabled]="!email()"
                [attr.aria-disabled]="!email()"
                [href]="mailtoHref()"
                data-testid="transfer-send-email"
                (click)="onSendEmail($event)"
              >
                {{ 'transfer.modal.shareByEmail' | translate }}
              </a>
            </div>
          </div>

          <p class="tt-explain" data-testid="transfer-explain">{{ 'transfer.modal.recipientHint' | translate }}</p>

          <div class="ev-card-actions confirm-actions">
            <button type="button" class="btn primary" data-testid="transfer-done" (click)="closed.emit()">
              {{ 'common.understood' | translate }}
            </button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .tt-head {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.55rem;
        text-align: center;
      }
      .tt-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: var(--pe-accent-soft, rgba(225, 78, 202, 0.14));
        color: var(--pe-accent, #e14eca);
      }
      .tt-icon.ok {
        background: var(--pe-success-soft, rgba(53, 208, 127, 0.16));
        color: var(--pe-success, #35d07f);
      }
      .tt-serial {
        text-align: center;
        color: var(--pe-muted);
      }
      .tt-points {
        margin: 0.6rem 0 1rem;
        padding-left: 1.1rem;
        line-height: 1.55;
      }
      .tt-share-lead,
      .tt-explain {
        text-align: center;
        line-height: 1.5;
      }
      .tt-explain {
        color: var(--pe-muted);
        font-size: 0.9rem;
        margin-top: 0.6rem;
      }
      .tt-code {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.6rem;
        margin: 1rem 0;
      }
      .tt-code code {
        font-size: 1.4rem;
        font-weight: 800;
        letter-spacing: 0.12em;
        padding: 0.5rem 0.9rem;
        border-radius: var(--pe-radius-sm);
        background: var(--pe-accent-soft, rgba(225, 78, 202, 0.14));
        color: var(--pe-accent-strong, #f06be0);
      }
      .tt-email-row {
        display: flex;
        gap: 0.5rem;
        margin-top: 0.3rem;
      }
      .tt-email-row input {
        flex: 1 1 auto;
        min-width: 0;
      }
      .btn.disabled,
      .btn[aria-disabled='true'] {
        opacity: 0.5;
        pointer-events: none;
      }
      .confirm-actions {
        justify-content: center;
      }
      .confirm-actions .btn {
        min-width: 130px;
        justify-content: center;
      }
    `,
  ],
})
export class TicketTransferModal {
  /** Boleto a transferir. */
  readonly ticketId = input.required<string>();
  /** Serial para mostrar (opcional). */
  readonly serial = input<string | undefined>(undefined);
  /** Se emite al cerrar el modal (cualquier paso). */
  readonly closed = output<void>();
  /** Se emite cuando la transferencia se inició con éxito (para refrescar). */
  readonly transferred = output<void>();

  private readonly tickets = inject(TicketsApi);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly injector = inject(Injector);
  private readonly siteUrl = inject(SITE_URL, { optional: true }) ?? '';
  private readonly canAudit = inject(HttpClient, { optional: true }) !== null;

  protected readonly step = signal<Step>('info');
  protected readonly working = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly code = signal('');
  protected readonly email = signal('');
  protected readonly copied = signal(false);

  /** Link de canje que acompaña el código compartido. */
  private readonly claimUrl = computed(() => `${this.siteUrl}/transferencias/reclamar`);

  /** mailto: prellenado con el código y el link de canje. */
  protected readonly mailtoHref = computed(() => {
    const subject = this.translate.instant('transfer.modal.emailSubject');
    const body = this.translate.instant('transfer.modal.emailBody', {
      code: this.code(),
      url: this.claimUrl(),
    });
    return `mailto:${encodeURIComponent(this.email())}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;
  });

  /** Confirma el regalo: audita (no-repudio) y crea la transferencia. */
  protected confirm(): void {
    if (this.working()) return;
    this.working.set(true);
    this.error.set(null);
    if (this.canAudit) {
      this.injector
        .get(AuditApi)
        .confirm('ticket.transfer', this.ticketId())
        .subscribe({ error: () => undefined });
    }
    this.tickets.transfer(this.ticketId()).subscribe({
      next: (t) => {
        this.working.set(false);
        this.code.set(t.code);
        this.step.set('share');
        this.transferred.emit();
      },
      error: () => {
        this.working.set(false);
        this.error.set(this.translate.instant('transfer.modal.startError'));
      },
    });
  }

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.code());
      this.copied.set(true);
      this.toasts.success(this.translate.instant('transfer.modal.copied'));
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.copied.set(false);
    }
  }

  /** Evita seguir el mailto si no hay correo escrito. */
  protected onSendEmail(ev: Event): void {
    if (!this.email()) ev.preventDefault();
  }
}
