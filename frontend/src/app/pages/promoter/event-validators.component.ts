import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ValidatorsApi } from '../../core/api/validators.api';
import type { ValidatorInviteResponseDto, ValidatorListItemDto } from '../../core/api/types';
import { ToastService } from '../../core/ui/toast.service';
import { apiErrorMessage } from '../../core/http/api-error';
import { ConfirmController } from '../../shared/confirm-dialog/confirm-controller';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';

/**
 * Gestión de validadores del evento (tab del editor). El promotor invita por email
 * a quienes validarán boletos en la puerta; ve su estado y puede deshabilitar/
 * rehabilitar (corta o rota el acceso al instante). Tras invitar/rehabilitar muestra
 * el enlace + código UNA sola vez (no se pueden re-derivar) para compartir con el
 * validador. El link abre la PWA de validación (`/validar/:token`).
 */
@Component({
  selector: 'app-event-validators',
  imports: [FormsModule, TranslatePipe, ConfirmDialogComponent],
  templateUrl: './event-validators.component.html',
})
export class EventValidatorsComponent {
  readonly eventId = input.required<string>();

  private readonly api = inject(ValidatorsApi);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);
  protected readonly confirm = new ConfirmController();

  protected readonly items = signal<ValidatorListItemDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly email = signal('');
  protected readonly working = signal(false);
  /** Acceso recién emitido a mostrar UNA vez (url + código). */
  protected readonly issued = signal<ValidatorInviteResponseDto | null>(null);

  constructor() {
    // input.required no está disponible en el constructor; cargamos en el 1er render.
    queueMicrotask(() => this.load());
  }

  private load(): void {
    this.loading.set(true);
    this.api.list(this.eventId()).subscribe({
      next: (rows) => {
        this.items.set(rows);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(apiErrorMessage(err, this.translate.instant('promoter.validators.loadError')));
      },
    });
  }

  protected invite(): void {
    const email = this.email().trim();
    if (!email || this.working()) return;
    this.working.set(true);
    this.api.invite(this.eventId(), email).subscribe({
      next: (res) => {
        this.working.set(false);
        this.email.set('');
        this.issued.set(res);
        this.toasts.success(this.translate.instant('promoter.validators.invited', { email: res.email }));
        this.load();
      },
      error: (err) => {
        this.working.set(false);
        this.toasts.error(apiErrorMessage(err, this.translate.instant('promoter.validators.inviteError')));
      },
    });
  }

  protected disable(v: ValidatorListItemDto): void {
    this.confirm.ask({
      title: this.translate.instant('promoter.validators.disableTitle'),
      message: this.translate.instant('promoter.validators.disableBody', { email: v.email }),
      confirmLabel: this.translate.instant('promoter.validators.disableConfirm'),
      danger: true,
      onConfirm: () =>
        this.api.disable(this.eventId(), v.id).subscribe({
          next: () => {
            this.toasts.success(this.translate.instant('promoter.validators.disabled'));
            this.load();
          },
          error: (err) => this.toasts.error(apiErrorMessage(err, this.translate.instant('promoter.validators.actionError'))),
        }),
    });
  }

  protected enable(v: ValidatorListItemDto): void {
    this.api.enable(this.eventId(), v.id).subscribe({
      next: (res) => {
        this.issued.set(res);
        this.toasts.success(this.translate.instant('promoter.validators.reenabled', { email: res.email }));
        this.load();
      },
      error: (err) => this.toasts.error(apiErrorMessage(err, this.translate.instant('promoter.validators.actionError'))),
    });
  }

  protected disableAll(): void {
    this.confirm.ask({
      title: this.translate.instant('promoter.validators.disableAllTitle'),
      message: this.translate.instant('promoter.validators.disableAllBody'),
      confirmLabel: this.translate.instant('promoter.validators.disableAllConfirm'),
      danger: true,
      onConfirm: () =>
        this.api.disableAll(this.eventId()).subscribe({
          next: (r) => {
            this.toasts.success(this.translate.instant('promoter.validators.disabledN', { n: Number(r.disabled) || 0 }));
            this.load();
          },
          error: (err) => this.toasts.error(apiErrorMessage(err, this.translate.instant('promoter.validators.actionError'))),
        }),
    });
  }

  protected copy(text: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
      this.toasts.info(this.translate.instant('promoter.validators.copied'));
    }
  }

  protected dismissIssued(): void {
    this.issued.set(null);
  }

  protected readonly hasActive = () => this.items().some((v) => v.status === 'active');
}
