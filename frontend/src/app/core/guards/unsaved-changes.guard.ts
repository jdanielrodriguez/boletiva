import { CanDeactivateFn } from '@angular/router';
import { Observable, Subject } from 'rxjs';
import type { ConfirmRequest } from '../../shared/confirm-dialog/confirm-dialog.component';

/**
 * Formulario de creación/edición que puede tener cambios SIN GUARDAR. Los
 * componentes que lo implementan participan del `unsavedChangesGuard`: si hay
 * cambios pendientes al navegar fuera (Atrás, cancelar, otra ruta) se les pide
 * confirmar antes de descartar.
 */
export interface HasUnsavedChanges {
  /** true si hay datos ingresados/cambiados aún sin persistir. */
  hasUnsavedChanges(): boolean;
  /** Abre el modal "¿descartar cambios?" y resuelve true (descartar) / false (seguir). */
  confirmDiscard(): Observable<boolean>;
}

/**
 * CanDeactivate REUTILIZABLE (v3.10 · GIV): al salir de un formulario con cambios
 * sin guardar, delega en el propio modal del componente (`confirmDiscard`) para
 * decidir si abandona la vista. Sin cambios → deja navegar sin preguntar.
 */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  if (!component || typeof component.hasUnsavedChanges !== 'function') return true;
  if (!component.hasUnsavedChanges()) return true;
  return component.confirmDiscard();
};

/**
 * Implementación estándar de `confirmDiscard()` reutilizando el `confirm-dialog`
 * del componente. Recibe el setter de la `ConfirmRequest` y un traductor; devuelve
 * un Observable<boolean> que emite true si el usuario acepta descartar los cambios,
 * false si decide seguir editando (cancela). El componente debe invocar `onCancel`
 * de la request al cerrar el modal por "cancelar".
 */
export function promptDiscardChanges(
  setConfirm: (req: ConfirmRequest) => void,
  t: (key: string) => string,
): Observable<boolean> {
  const result = new Subject<boolean>();
  setConfirm({
    title: t('common.discardChangesTitle'),
    message: t('common.discardChangesMessage'),
    confirmLabel: t('common.discard'),
    confirmIcon: 'delete',
    danger: true,
    onConfirm: () => {
      result.next(true);
      result.complete();
    },
    onCancel: () => {
      result.next(false);
      result.complete();
    },
  });
  return result;
}
