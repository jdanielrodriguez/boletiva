import { signal } from '@angular/core';
import type { ConfirmRequest } from './confirm-dialog.component';

/**
 * Controlador REUTILIZABLE del modal de confirmación (homologación DRY). Encapsula
 * el patrón idéntico que vivía duplicado en ~9 componentes: una señal con la
 * petición pendiente + los handlers de aceptar/cancelar (que cierran el modal y
 * ejecutan `onConfirm` / `onCancel`). Se instancia por componente
 * (`new ConfirmController()`) y en la plantilla se enlaza:
 *
 *   @if (confirm.request(); as cf) {
 *     <app-confirm-dialog ...
 *       (accept)="confirm.accept()" (cancelled)="confirm.cancel()" />
 *   }
 *
 * NO cambia comportamiento: `cancel()` invoca `onCancel?.()` (opcional), igual que
 * los sitios que ya lo usaban; los que no lo definen quedan como no-op.
 */
export class ConfirmController {
  /** Petición actualmente abierta (o `null` si el modal está cerrado). */
  readonly request = signal<ConfirmRequest | null>(null);

  /** Abre el modal con la petición dada. */
  ask(req: ConfirmRequest): void {
    this.request.set(req);
  }

  /** Cierra el modal sin ejecutar ninguna acción. */
  close(): void {
    this.request.set(null);
  }

  /** Cierra el modal y ejecuta la acción confirmada. */
  accept(): void {
    const c = this.request();
    this.request.set(null);
    c?.onConfirm();
  }

  /** Cierra el modal y ejecuta el callback de cancelación si lo hay. */
  cancel(): void {
    const c = this.request();
    this.request.set(null);
    c?.onCancel?.();
  }
}
