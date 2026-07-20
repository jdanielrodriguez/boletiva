import { Component, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { ToastService } from '../../core/ui/toast.service';

/**
 * Contenedor global de toasts (arriba a la derecha). Región aria-live para
 * accesibilidad; cada toast lleva icono + color sólido por severidad y se puede
 * cerrar. Se monta una sola vez en el App root. Iconos = SVG inline (nada de
 * emojis que rendericen como "tofu" en algunos sistemas).
 */
@Component({
  selector: 'app-toast-container',
  template: `
    <div class="toast-stack" role="region" aria-live="polite" [attr.aria-label]="tr('common.notifications')">
      @for (t of toasts.toasts(); track t.id) {
        <div
          class="toast toast-{{ t.kind }}"
          [attr.data-testid]="'toast-' + t.kind"
          [attr.role]="t.kind === 'error' || t.kind === 'warning' ? 'alert' : 'status'"
        >
          <span class="toast-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor">
              @switch (t.kind) {
                @case ('success') {
                  <path d="M20 6L9 17l-5-5" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
                }
                @case ('warning') {
                  <path d="M12 3l9.5 16.5H2.5L12 3z" stroke-width="2.2" stroke-linejoin="round" />
                  <path d="M12 10v4M12 17.5v.01" stroke-width="2.4" stroke-linecap="round" />
                }
                @case ('error') {
                  <circle cx="12" cy="12" r="9" stroke-width="2.2" />
                  <path d="M15 9l-6 6M9 9l6 6" stroke-width="2.4" stroke-linecap="round" />
                }
                @default {
                  <circle cx="12" cy="12" r="9" stroke-width="2.2" />
                  <path d="M12 11v5M12 7.5v.01" stroke-width="2.4" stroke-linecap="round" />
                }
              }
            </svg>
          </span>
          <span class="toast-msg">{{ t.message }}</span>
          <button type="button" class="toast-close" [attr.aria-label]="tr('common.dismissNotification')" (click)="toasts.dismiss(t.id)">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      }
    </div>
  `,
})
export class ToastContainer {
  protected readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);
  protected tr(key: string): string {
    return this.translate.instant(key);
  }
}
