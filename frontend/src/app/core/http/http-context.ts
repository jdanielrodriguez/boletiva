import { HttpContext, HttpContextToken } from '@angular/common/http';

/**
 * Marca una petición como "silenciosa/background": NO debe oscurecer la pantalla
 * con el overlay de carga global (v3.9 · C1). Se usa para sondeos de fondo
 * (estado de mantenimiento, hidratación de sesión) que no deben tapar la UI. El
 * SSE (EventSource) y el refresh (HttpClient directo) ya NO pasan por la cadena
 * de interceptores, así que quedan excluidos automáticamente.
 */
export const SILENT = new HttpContextToken<boolean>(() => false);

/** Contexto HTTP que marca la petición como silenciosa (sin overlay). */
export function silentContext(): HttpContext {
  return new HttpContext().set(SILENT, true);
}
