import type { BulkSeatInput } from '../../core/api/promoter-events.api';
import { rowLabel } from './seat-grid';
import { SEAT_GRID } from './seat-collision';

/**
 * Plantillas de disposición de asientos (pre-configuraciones). Cada función es
 * PURA y determinista → produce `BulkSeatInput[]` con coordenadas x/y sin
 * solapamientos (verificado en el spec), listo para guardar (bulk) y editar luego
 * en el canvas. Los iconos SVG se muestran en el desplegable "Agregar plantilla".
 */
export type SeatTemplateId = 'rows' | 'theater' | 'stadium' | 'tables';

export interface SeatTemplateDef {
  id: SeatTemplateId;
  name: string;
  hint: string;
  /** Icono SVG (inline, seguro: contenido estático) para el desplegable. */
  icon: string;
}

const ORIGIN = 40;

export const SEAT_TEMPLATES: SeatTemplateDef[] = [
  {
    id: 'rows',
    name: 'Filas rectas',
    hint: '8 filas × 12 asientos alineados',
    icon: '<svg viewBox="0 0 40 40" width="40" height="40"><g fill="#e14eca"><rect x="6" y="8" width="28" height="4" rx="2"/><rect x="6" y="18" width="28" height="4" rx="2"/><rect x="6" y="28" width="28" height="4" rx="2"/></g></svg>',
  },
  {
    id: 'theater',
    name: 'Teatro (curvo)',
    hint: 'Filas curvadas hacia el escenario',
    icon: '<svg viewBox="0 0 40 40" width="40" height="40"><g fill="none" stroke="#e14eca" stroke-width="4" stroke-linecap="round"><path d="M6 14 Q20 8 34 14"/><path d="M6 24 Q20 18 34 24"/><path d="M6 34 Q20 28 34 34"/></g></svg>',
  },
  {
    id: 'stadium',
    name: 'Estadio',
    hint: 'Gradas en los cuatro lados de la cancha',
    icon: '<svg viewBox="0 0 40 40" width="40" height="40"><rect x="4" y="4" width="32" height="32" rx="6" fill="none" stroke="#e14eca" stroke-width="4"/><rect x="14" y="14" width="12" height="12" rx="2" fill="#e14eca" opacity="0.4"/></svg>',
  },
  {
    id: 'tables',
    name: 'Mesas redondas',
    hint: '6 mesas de 8 asientos',
    icon: '<svg viewBox="0 0 40 40" width="40" height="40"><g fill="#e14eca"><circle cx="12" cy="12" r="5"/><circle cx="28" cy="12" r="5"/><circle cx="12" cy="28" r="5"/><circle cx="28" cy="28" r="5"/></g></svg>',
  },
];

/** Filas rectas: cuadrícula alineada estándar. */
function rowsTemplate(section: string): BulkSeatInput[] {
  const seats: BulkSeatInput[] = [];
  for (let r = 0; r < 8; r++) {
    const row = rowLabel(r + 1);
    for (let c = 0; c < 12; c++) {
      seats.push({
        label: `${row}-${c + 1}`,
        section: section || undefined,
        row,
        x: ORIGIN + c * SEAT_GRID,
        y: ORIGIN + r * SEAT_GRID,
      });
    }
  }
  return seats;
}

/**
 * Teatro: filas curvadas. La separación horizontal por columna (SEAT_GRID) evita
 * colisiones dentro de la fila; la curva solo desplaza `y` (los ejes x separan).
 */
function theaterTemplate(section: string): BulkSeatInput[] {
  const seats: BulkSeatInput[] = [];
  const cols = 14;
  const center = (cols - 1) / 2;
  for (let r = 0; r < 8; r++) {
    const row = rowLabel(r + 1);
    for (let c = 0; c < cols; c++) {
      const curve = Math.round((c - center) * (c - center) * 0.5);
      seats.push({
        label: `${row}-${c + 1}`,
        section: section || undefined,
        row,
        x: ORIGIN + c * SEAT_GRID,
        y: ORIGIN + r * SEAT_GRID + curve,
      });
    }
  }
  return seats;
}

/** Estadio: cuatro bloques (gradas) rodeando la cancha central, sin solaparse. */
function stadiumTemplate(section: string): BulkSeatInput[] {
  const seats: BulkSeatInput[] = [];
  const cols = 12;
  const rowsPerBlock = 3;
  const width = cols * SEAT_GRID;
  const push = (block: string, r: number, c: number, x: number, y: number) =>
    seats.push({ label: `${block}-${r + 1}-${c + 1}`, section: section ? `${section} ${block}` : block, row: `${block}${r + 1}`, x, y });

  // Norte (arriba) y Sur (abajo): filas horizontales.
  for (let r = 0; r < rowsPerBlock; r++) {
    for (let c = 0; c < cols; c++) {
      push('N', r, c, ORIGIN + c * SEAT_GRID, ORIGIN + r * SEAT_GRID);
      push('S', r, c, ORIGIN + c * SEAT_GRID, ORIGIN + (rowsPerBlock + 6 + r) * SEAT_GRID);
    }
  }
  // Este y Oeste: bloques laterales (a los lados de la cancha).
  const sideTop = ORIGIN + (rowsPerBlock + 1) * SEAT_GRID;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < rowsPerBlock; c++) {
      push('O', r, c, ORIGIN + c * SEAT_GRID, sideTop + r * SEAT_GRID);
      push('E', r, c, ORIGIN + (cols - rowsPerBlock + c) * SEAT_GRID, sideTop + r * SEAT_GRID);
    }
  }
  void width;
  return seats;
}

/** Mesas redondas: 6 mesas (2×3) de 8 asientos en círculo; mesas bien separadas. */
function tablesTemplate(section: string): BulkSeatInput[] {
  const seats: BulkSeatInput[] = [];
  const perTable = 8;
  const radius = 46;
  const spacing = 170;
  let t = 0;
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 3; tx++) {
      t++;
      const cx = ORIGIN + radius + tx * spacing;
      const cy = ORIGIN + radius + ty * spacing;
      for (let s = 0; s < perTable; s++) {
        const angle = (s / perTable) * Math.PI * 2;
        seats.push({
          label: `M${t}-${s + 1}`,
          section: section ? `${section} M${t}` : `Mesa ${t}`,
          row: `M${t}`,
          x: Math.round(cx + radius * Math.cos(angle)),
          y: Math.round(cy + radius * Math.sin(angle)),
        });
      }
    }
  }
  return seats;
}

/** Construye los asientos de una plantilla. */
export function buildTemplate(id: SeatTemplateId, section = ''): BulkSeatInput[] {
  switch (id) {
    case 'rows':
      return rowsTemplate(section);
    case 'theater':
      return theaterTemplate(section);
    case 'stadium':
      return stadiumTemplate(section);
    case 'tables':
      return tablesTemplate(section);
    default:
      return [];
  }
}
