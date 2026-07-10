/**
 * Utilidades PURAS de posicionamiento de asientos: snap a cuadrícula y detección
 * de solapamiento (colisión). Sin dependencias de Konva/DOM → testeables. Dos
 * asientos "colisionan" si sus centros quedan dentro de una caja de `minDistance`
 * px en ambos ejes (footprint de la sillita ≈ 26px + margen).
 */

/** Separación base de la cuadrícula (px) y distancia mínima entre asientos. */
export const SEAT_GRID = 34;
export const SEAT_MIN_DISTANCE = 28;

export interface Point {
  x: number;
  y: number;
}

/** Ajusta una coordenada a la cuadrícula más cercana (snap). */
export function snapToGrid(v: number, grid = SEAT_GRID): number {
  return Math.round(v / grid) * grid;
}

/**
 * ¿La posición (x,y) se solapa con algún asiento de `seats`? `skipIndex` excluye
 * al asiento que se está moviendo (para no colisionar consigo mismo).
 */
export function collides(
  seats: readonly Point[],
  x: number,
  y: number,
  opts: { skipIndex?: number; minDistance?: number } = {},
): boolean {
  const min = opts.minDistance ?? SEAT_MIN_DISTANCE;
  return seats.some(
    (s, i) => i !== opts.skipIndex && Math.abs(s.x - x) < min && Math.abs(s.y - y) < min,
  );
}

/** ¿Existe algún par de asientos que se solapen en toda la disposición? */
export function hasAnyOverlap(seats: readonly Point[], minDistance = SEAT_MIN_DISTANCE): boolean {
  for (let i = 0; i < seats.length; i++) {
    for (let j = i + 1; j < seats.length; j++) {
      if (
        Math.abs(seats[i].x - seats[j].x) < minDistance &&
        Math.abs(seats[i].y - seats[j].y) < minDistance
      ) {
        return true;
      }
    }
  }
  return false;
}
