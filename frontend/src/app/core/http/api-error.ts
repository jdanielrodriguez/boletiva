/**
 * Extrae el mensaje de error REAL que envía el backend (contrato uniforme
 * `{ statusCode, error, message, ... }` del AllExceptionsFilter). `message` puede ser
 * string o, en errores de validación (class-validator), un arreglo de strings. Si no
 * hay mensaje utilizable, devuelve el `fallback` traducido del llamador.
 *
 * Sirve para NO mostrar mensajes genéricos/equivocados: el usuario ve la causa real
 * (p.ej. "Captcha inválido", "El evento ya no está disponible") en vez de un texto fijo.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const body = (err as { error?: { message?: unknown } } | null | undefined)?.error;
  const msg = body?.message;
  if (Array.isArray(msg)) {
    const joined = msg.filter((m) => typeof m === 'string' && m.trim()).join(' · ');
    return joined || fallback;
  }
  if (typeof msg === 'string' && msg.trim()) return msg;
  return fallback;
}
