import { Component, inject } from '@angular/core';
import { ToastService } from '../../core/ui/toast.service';

/**
 * Contenedor global de toasts (arriba a la derecha). Región aria-live para
 * accesibilidad; cada toast tiene color por severidad y se puede cerrar con la ✕.
 * Se monta una sola vez en el App root.
 */
@Component({
  selector: 'app-toast-container',
  template: `
    <div class="toast-stack" role="region" aria-live="polite" aria-label="Notificaciones">
      @for (t of toasts.toasts(); track t.id) {
        <div class="toast toast-{{ t.kind }}" [attr.data-testid]="'toast-' + t.kind" role="status">
          <span class="toast-msg">{{ t.message }}</span>
          <button type="button" class="toast-close" aria-label="Cerrar" (click)="toasts.dismiss(t.id)">✕</button>
        </div>
      }
    </div>
  `,
})
export class ToastContainer {
  protected readonly toasts = inject(ToastService);
}
