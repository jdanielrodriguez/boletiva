import { hasAnyOverlap, type Point } from './seat-collision';
import type { BulkSeatInput } from '../../core/api/promoter-events.api';
import {
  generateGrid,
  generateCurve,
  generateTables,
  generateLine,
  seatsAlongLine,
  SEAT_GENERATORS,
} from './seat-generators';

const pts = (seats: BulkSeatInput[]): Point[] => seats.map((s) => ({ x: s.x as number, y: s.y as number }));

describe('seat-generators (generadores paramétricos)', () => {
  it('cuadrícula produce rows×cols sin solapamientos', () => {
    const seats = generateGrid(4, 6, 'Platea');
    expect(seats.length).toBe(24);
    expect(hasAnyOverlap(pts(seats))).toBe(false);
    expect(seats[0].section).toBe('Platea');
  });

  it('curva produce rows×cols sin solapamientos', () => {
    const seats = generateCurve(5, 10);
    expect(seats.length).toBe(50);
    expect(hasAnyOverlap(pts(seats))).toBe(false);
  });

  it('mesas: tableCount × perTable, con asientos por mesa configurable, sin solapamientos', () => {
    const seats = generateTables(4, 6, 'VIP');
    expect(seats.length).toBe(24);
    expect(hasAnyOverlap(pts(seats))).toBe(false);
    // Cada mesa etiqueta sus asientos con su número.
    expect(seats.filter((s) => s.row === 'M1').length).toBe(6);
  });

  it('línea produce count asientos en una fila sin solapamientos', () => {
    const seats = generateLine(8);
    expect(seats.length).toBe(8);
    expect(hasAnyOverlap(pts(seats))).toBe(false);
    expect(new Set(seats.map((s) => s.y)).size).toBe(1); // misma fila
  });

  it('el menú de generadores incluye los 4 tipos y mesas pide un parámetro', () => {
    const ids = SEAT_GENERATORS.map((g) => g.id);
    expect(ids).toEqual(['grid', 'tables', 'curve', 'line']);
    expect(SEAT_GENERATORS.find((g) => g.id === 'tables')?.param).toBeTruthy();
  });

  describe('seatsAlongLine (trazo por arrastre)', () => {
    it('coloca asientos a lo largo del recorrido', () => {
      const placed = seatsAlongLine({ x: 40, y: 40 }, { x: 200, y: 40 }, []);
      expect(placed.length).toBeGreaterThan(1);
      // Sin solapamientos entre los colocados.
      expect(hasAnyOverlap(placed)).toBe(false);
    });

    it('omite SOLO los asientos que caen encima de uno existente (los demás sí se colocan)', () => {
      // Un asiento existente justo en el trazo.
      const existing = [{ x: 108, y: 34 }];
      const placed = seatsAlongLine({ x: 40, y: 40 }, { x: 244, y: 40 }, existing);
      // Ninguno de los colocados colisiona con el existente.
      const clash = placed.some((p) => Math.abs(p.x - existing[0].x) < 28 && Math.abs(p.y - existing[0].y) < 28);
      expect(clash).toBe(false);
      // Pero sí colocó varios (no abortó el trazo entero).
      expect(placed.length).toBeGreaterThanOrEqual(3);
    });
  });
});
