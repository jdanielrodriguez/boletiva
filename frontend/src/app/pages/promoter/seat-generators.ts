import type { BulkSeatInput } from '../../core/api/promoter-events.api';
import { rowLabel } from './seat-grid';
import { SEAT_GRID, snapToGrid, collides, type Point } from './seat-collision';

/**
 * Generadores PARAMÉTRICOS de asientos (cuadrícula, mesas, curva, línea) + el
 * trazado por arrastre (drag) del canvas. Todo PURO y determinista → produce
 * `BulkSeatInput[]` sin solapamientos (verificado en el spec), listo para editar y
 * guardar. Reemplazan al botón "Agregar plantilla" por un menú general "Generar"
 * (las plantillas SVG siguen viviendo en seat-templates.ts como presets).
 */
export type GeneratorId = 'grid' | 'tables' | 'curve' | 'line';

export interface GeneratorDef {
  id: GeneratorId;
  name: string;
  hint: string;
  /** Si pide un parámetro extra (p. ej. asientos por mesa). */
  param?: { label: string; default: number; min: number; max: number };
}

/** Menú de generadores; ampliable a futuro añadiendo entradas aquí. */
export const SEAT_GENERATORS: GeneratorDef[] = [
  { id: 'grid', name: 'Generar cuadrícula', hint: 'Filas × asientos alineados (usa los campos de arriba)' },
  {
    id: 'tables',
    name: 'Generar mesas',
    hint: 'Mesas redondas con asientos alrededor',
    param: { label: 'Asientos por mesa', default: 8, min: 2, max: 20 },
  },
  { id: 'curve', name: 'Generar curva', hint: 'Filas curvadas hacia el escenario' },
  { id: 'line', name: 'Generar línea', hint: 'Una fila recta de asientos' },
];

const ORIGIN = 40;

/** Cuadrícula recta: `rows` × `cols`. */
export function generateGrid(rows: number, cols: number, section = ''): BulkSeatInput[] {
  const seats: BulkSeatInput[] = [];
  const r = Math.max(1, Math.min(500, Math.floor(rows)));
  const c = Math.max(1, Math.min(500, Math.floor(cols)));
  for (let i = 0; i < r; i++) {
    const row = rowLabel(i + 1);
    for (let j = 0; j < c; j++) {
      seats.push({
        label: `${row}-${j + 1}`,
        section: section || undefined,
        row,
        x: ORIGIN + j * SEAT_GRID,
        y: ORIGIN + i * SEAT_GRID,
      });
    }
  }
  return seats;
}

/** Curva: filas curvadas hacia el escenario. La separación horizontal evita colisión. */
export function generateCurve(rows: number, cols: number, section = ''): BulkSeatInput[] {
  const seats: BulkSeatInput[] = [];
  const r = Math.max(1, Math.min(60, Math.floor(rows)));
  const c = Math.max(2, Math.min(80, Math.floor(cols)));
  const center = (c - 1) / 2;
  for (let i = 0; i < r; i++) {
    const row = rowLabel(i + 1);
    for (let j = 0; j < c; j++) {
      const curve = Math.round((j - center) * (j - center) * 0.5);
      seats.push({
        label: `${row}-${j + 1}`,
        section: section || undefined,
        row,
        x: ORIGIN + j * SEAT_GRID,
        y: ORIGIN + i * SEAT_GRID + curve,
      });
    }
  }
  return seats;
}

/** Mesas redondas: `tableCount` mesas de `perTable` asientos, en rejilla, sin solaparse. */
export function generateTables(tableCount: number, perTable: number, section = ''): BulkSeatInput[] {
  const seats: BulkSeatInput[] = [];
  const tables = Math.max(1, Math.min(60, Math.floor(tableCount)));
  const per = Math.max(2, Math.min(20, Math.floor(perTable)));
  const radius = Math.max(46, Math.round((per * SEAT_GRID) / (2 * Math.PI)) + 10);
  const spacing = radius * 2 + SEAT_GRID * 2;
  const perRow = Math.max(1, Math.ceil(Math.sqrt(tables)));
  for (let t = 0; t < tables; t++) {
    const tx = t % perRow;
    const ty = Math.floor(t / perRow);
    const cx = ORIGIN + radius + tx * spacing;
    const cy = ORIGIN + radius + ty * spacing;
    for (let s = 0; s < per; s++) {
      const angle = (s / per) * Math.PI * 2;
      seats.push({
        label: `M${t + 1}-${s + 1}`,
        section: section ? `${section} M${t + 1}` : `Mesa ${t + 1}`,
        row: `M${t + 1}`,
        x: Math.round(cx + radius * Math.cos(angle)),
        y: Math.round(cy + radius * Math.sin(angle)),
      });
    }
  }
  return seats;
}

/** Línea recta horizontal de `count` asientos. */
export function generateLine(count: number, section = ''): BulkSeatInput[] {
  const seats: BulkSeatInput[] = [];
  const n = Math.max(1, Math.min(500, Math.floor(count)));
  for (let j = 0; j < n; j++) {
    seats.push({
      label: `L-${j + 1}`,
      section: section || undefined,
      row: 'A',
      x: ORIGIN + j * SEAT_GRID,
      y: ORIGIN,
    });
  }
  return seats;
}

/** Asiento colocado por un trazo de arrastre. */
export interface PlacedSeat {
  x: number;
  y: number;
}

/**
 * Coloca asientos a lo largo del trazo `from → to` (drag "Línea"): muestrea puntos
 * cada `SEAT_GRID` px, los ajusta a la cuadrícula y agrega SOLO los que no colisionan
 * (ni con los ya existentes ni con los recién colocados en el mismo trazo). Un asiento
 * que caería encima de otro simplemente NO se coloca; los demás sí. PURO/testeable.
 */
export function seatsAlongLine(
  from: Point,
  to: Point,
  existing: readonly Point[],
  minDistance?: number,
): PlacedSeat[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.round(length / SEAT_GRID));
  const placed: PlacedSeat[] = [];
  const all: Point[] = [...existing];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = snapToGrid(from.x + dx * t);
    const y = snapToGrid(from.y + dy * t);
    if (collides(all, x, y, { minDistance })) continue; // ese punto choca → se omite
    placed.push({ x, y });
    all.push({ x, y });
  }
  return placed;
}
