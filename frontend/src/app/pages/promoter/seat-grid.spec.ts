import { buildGrid, rowLabel } from './seat-grid';

describe('seat-grid', () => {
  describe('rowLabel', () => {
    it('mapea 1→A, 26→Z, 27→AA', () => {
      expect(rowLabel(1)).toBe('A');
      expect(rowLabel(26)).toBe('Z');
      expect(rowLabel(27)).toBe('AA');
    });
  });

  describe('buildGrid', () => {
    it('genera rows*cols asientos con etiquetas y coordenadas', () => {
      const seats = buildGrid({ rows: 2, cols: 3, gap: 10, origin: 5, section: 'Platea' });
      expect(seats.length).toBe(6);
      expect(seats[0]).toEqual({ label: 'A-1', section: 'Platea', row: 'A', x: 5, y: 5 });
      expect(seats[3]).toEqual({ label: 'B-1', section: 'Platea', row: 'B', x: 5, y: 15 });
      expect(seats[5]).toEqual({ label: 'B-3', section: 'Platea', row: 'B', x: 25, y: 15 });
    });

    it('sin sección deja section undefined y usa gap/origin por defecto', () => {
      const seats = buildGrid({ rows: 1, cols: 1 });
      expect(seats[0].section).toBeUndefined();
      expect(seats[0].x).toBe(30);
      expect(seats[0].y).toBe(30);
    });

    it('normaliza valores no válidos a al menos 1 fila y 1 columna', () => {
      expect(buildGrid({ rows: 0, cols: -3 }).length).toBe(1);
    });
  });
});
