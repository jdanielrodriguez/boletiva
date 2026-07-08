/**
 * Paginación KEYSET (cursor) para listados de alto volumen.
 *
 * En vez de `skip/take` (OFFSET, que escanea y descarta N filas → O(N) y además
 * salta/duplica filas si el conjunto cambia entre páginas), usamos un cursor sobre
 * `(campoDeOrden DESC, id DESC)`. El cursor es el `id` de la última fila: Prisma
 * hace un SEEK real al índice, sin escanear offset, y el resultado es estable ante
 * inserciones concurrentes (típico de un on-sale).
 *
 * El `id` (único) actúa de desempate determinista cuando el campo de orden
 * (createdAt/issuedAt) empata. El campo de orden debe ir en el `orderBy` junto al
 * `id`; el `cursor` de Prisma apunta al `id` (único).
 */

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export interface KeysetQuery {
  cursor?: string;
  limit?: number;
}

export interface KeysetResult<T> {
  items: T[];
  /** `id` de la última fila para pedir la página siguiente; null si no hay más. */
  nextCursor: string | null;
}

/** Normaliza el límite pedido al rango [1, MAX_PAGE_LIMIT] (default 20). */
export function clampLimit(limit?: number): number {
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.floor(n), MAX_PAGE_LIMIT);
}

/**
 * Args de Prisma para keyset: `take = limit + 1` (una fila sonda para saber si hay
 * página siguiente) y, si hay cursor, `cursor:{id} + skip:1` (excluye la fila del
 * cursor). El `orderBy` lo pone el llamador (tipado por modelo) e incluye el `id`.
 */
export function keysetTake(query: KeysetQuery): {
  take: number;
  cursor?: { id: string };
  skip?: number;
} {
  const limit = clampLimit(query.limit);
  return {
    take: limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  };
}

/** Corta la fila sonda y arma `{ items, nextCursor }`. */
export function keysetResult<T extends { id: string }>(
  rows: T[],
  query: KeysetQuery,
): KeysetResult<T> {
  const limit = clampLimit(query.limit);
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}
