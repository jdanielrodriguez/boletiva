import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { finalize } from 'rxjs';
import { LoadingStore } from '../ui/loading.store';
import { SILENT } from './http-context';

/**
 * Interceptor del overlay de carga GLOBAL (v3.9 · C1). Incrementa el contador de
 * peticiones en vuelo al iniciar y lo decrementa al completar/errored. Va PRIMERO
 * en la cadena para envolver todo el ciclo (incluido el reintento del refresh que
 * hace el authInterceptor) → una sola cuenta por petición de alto nivel.
 *
 * Excluye las peticiones marcadas como silenciosas (`SILENT`): sondeos de fondo
 * que no deben oscurecer la pantalla. El SSE (EventSource) y el refresh (HttpClient
 * directo) ni siquiera pasan por aquí.
 */
export const loadingInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.context.get(SILENT)) return next(req);

  const store = inject(LoadingStore);
  store.start();
  return next(req).pipe(finalize(() => store.stop()));
};
