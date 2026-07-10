import { buildTemplate, SEAT_TEMPLATES, type SeatTemplateId } from './seat-templates';
import { hasAnyOverlap } from './seat-collision';

describe('seat-templates', () => {
  it('expone las 4 plantillas con icono SVG', () => {
    expect(SEAT_TEMPLATES.map((t) => t.id)).toEqual(['rows', 'theater', 'stadium', 'tables']);
    expect(SEAT_TEMPLATES.every((t) => t.icon.includes('<svg'))).toBe(true);
  });

  const ids: SeatTemplateId[] = ['rows', 'theater', 'stadium', 'tables'];

  for (const id of ids) {
    describe(`plantilla ${id}`, () => {
      const seats = buildTemplate(id, 'Platea');

      it('genera asientos con coordenadas y etiqueta', () => {
        expect(seats.length).toBeGreaterThan(0);
        expect(seats.every((s) => typeof s.x === 'number' && typeof s.y === 'number')).toBe(true);
        expect(seats.every((s) => !!s.label)).toBe(true);
      });

      it('las etiquetas son únicas (bulk exige unicidad)', () => {
        const labels = seats.map((s) => s.label);
        expect(new Set(labels).size).toBe(labels.length);
      });

      it('NO produce asientos solapados (colisión)', () => {
        expect(hasAnyOverlap(seats.map((s) => ({ x: s.x as number, y: s.y as number })))).toBe(false);
      });
    });
  }

  it('propaga la sección al layout', () => {
    const seats = buildTemplate('rows', 'VIP');
    expect(seats[0].section).toBe('VIP');
  });
});
