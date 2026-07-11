import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';
import { API_BASE_URL } from '../config/api.tokens';
import { MaintenanceStore } from '../maintenance/maintenance.store';

/** Extrae el mensaje de mantenimiento del cuerpo del 503 si el backend lo envía. */
function messageFrom(err: HttpErrorResponse): string | null {
  const body = err.error as { message?: unknown } | null;
  const msg = body?.message;
  return typeof msg === 'string' ? msg : null;
}

/**
 * Interceptor de mantenimiento: cuando CUALQUIER petición al propio API responde
 * 503, la plataforma está en mantenimiento (el backend responde 503 a los no-admin
 * durante el mantenimiento). Marca el estado global → la app muestra la página de
 * mantenimiento sin necesidad de recargar. Un admin nunca recibe 503 (bypass en el
 * backend), así que el 503 implica usuario no-admin/anónimo.
 */
export const maintenanceInterceptor: HttpInterceptorFn = (req, next) => {
  const baseUrl = inject(API_BASE_URL);
  const store = inject(MaintenanceStore);

  if (!req.url.startsWith(baseUrl)) return next(req);

  return next(req).pipe(
    tap({
      error: (err: unknown) => {
        if (err instanceof HttpErrorResponse && err.status === 503) {
          store.markEnabled(messageFrom(err));
        }
      },
    }),
  );
};
