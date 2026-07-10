import { collides, hasAnyOverlap, snapToGrid, SEAT_GRID } from './seat-collision';

describe('seat-collision', () => {
  describe('snapToGrid', () => {
    it('ajusta al múltiplo de cuadrícula más cercano', () => {
      expect(snapToGrid(0)).toBe(0);
      expect(snapToGrid(16)).toBe(0); // 16 → 0 (más cerca de 0 que de 34)
      expect(snapToGrid(20)).toBe(SEAT_GRID); // 20 → 34
      expect(snapToGrid(50)).toBe(SEAT_GRID); // 50 → 34
      expect(snapToGrid(52)).toBe(SEAT_GRID * 2); // 52 → 68
    });
  });

  describe('collides', () => {
    const seats = [
      { x: 40, y: 40 },
      { x: 74, y: 40 },
    ];

    it('detecta solape cuando (x,y) cae encima de un asiento', () => {
      expect(collides(seats, 45, 42)).toBe(true);
    });

    it('NO colisiona a una celda de distancia (34 ≥ 28)', () => {
      expect(collides(seats, 40, 74)).toBe(false);
      expect(collides(seats, 108, 40)).toBe(false);
    });

    it('skipIndex excluye al asiento que se mueve (no colisiona consigo mismo)', () => {
      expect(collides(seats, 40, 40, { skipIndex: 0 })).toBe(false);
      expect(collides(seats, 74, 40, { skipIndex: 0 })).toBe(true); // choca con el otro
    });
  });

  describe('hasAnyOverlap', () => {
    it('false si todos están separados; true si dos se solapan', () => {
      expect(hasAnyOverlap([{ x: 0, y: 0 }, { x: 34, y: 0 }, { x: 0, y: 34 }])).toBe(false);
      expect(hasAnyOverlap([{ x: 0, y: 0 }, { x: 10, y: 10 }])).toBe(true);
    });
  });
});
