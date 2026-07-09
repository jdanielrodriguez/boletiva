import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type ToastKind = 'success' | 'info' | 'warning' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** ms que dura visible; 0 = no auto-cierra. */
  duration: number;
}

/** ms por defecto según severidad (los errores duran más para poder leerse). */
const DEFAULT_DURATION: Record<ToastKind, number> = {
  success: 3500,
  info: 4000,
  warning: 5000,
  error: 6000,
};

/**
 * Notificaciones tipo toast (reemplazan las notas grises). Cola reactiva por
 * signals; auto-cierre por tiempo (solo en navegador; en SSR no se agenda timer).
 * Los componentes llaman `toasts.success('...')`, `.error('...')`, etc.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly platformId = inject(PLATFORM_ID);
  private seq = 0;
  readonly toasts = signal<Toast[]>([]);

  private push(kind: ToastKind, message: string, duration?: number): number {
    const id = ++this.seq;
    const ms = duration ?? DEFAULT_DURATION[kind];
    this.toasts.update((list) => [...list, { id, kind, message, duration: ms }]);
    if (ms > 0 && isPlatformBrowser(this.platformId)) {
      setTimeout(() => this.dismiss(id), ms);
    }
    return id;
  }

  success(message: string, duration?: number): number {
    return this.push('success', message, duration);
  }
  info(message: string, duration?: number): number {
    return this.push('info', message, duration);
  }
  warning(message: string, duration?: number): number {
    return this.push('warning', message, duration);
  }
  error(message: string, duration?: number): number {
    return this.push('error', message, duration);
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  clear(): void {
    this.toasts.set([]);
  }
}
