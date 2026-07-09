import type { BulkSeatInput } from '../../core/api/promoter-events.api';

/** Parámetros para generar una cuadrícula de asientos posicionados. */
export interface GridParams {
  rows: number;
  cols: number;
  /** Separación horizontal/vertical en px del lienzo. */
  gap?: number;
  /** Margen inicial (px). */
  origin?: number;
  /** Prefijo de sección/etiqueta (p.ej. 'Platea'). */
  section?: string;
}

/** Letra de fila estilo hoja de cálculo: 1→A … 26→Z, 27→AA… */
export function rowLabel(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/**
 * Construye una cuadrícula de asientos con etiqueta (`A-1`, `A-2`, `B-1`…),
 * fila (`A`) y coordenadas x/y para el mapa. Pura y determinista → testeable sin
 * Konva. Se envía tal cual a `POST /localities/:id/seats` (bulk).
 */
export function buildGrid(params: GridParams): BulkSeatInput[] {
  const rows = Math.max(1, Math.floor(params.rows));
  const cols = Math.max(1, Math.floor(params.cols));
  const gap = params.gap ?? 34;
  const origin = params.origin ?? 30;
  const seats: BulkSeatInput[] = [];
  for (let r = 0; r < rows; r++) {
    const row = rowLabel(r + 1);
    for (let c = 0; c < cols; c++) {
      seats.push({
        label: `${row}-${c + 1}`,
        section: params.section || undefined,
        row,
        x: origin + c * gap,
        y: origin + r * gap,
      });
    }
  }
  return seats;
}
