import { slugify, slugWithSuffix } from './slug';

describe('slugify', () => {
  it('quita acentos y pasa a kebab-case', () => {
    expect(slugify('Educación Musical')).toBe('educacion-musical');
  });

  it('colapsa caracteres no alfanuméricos', () => {
    expect(slugify('  ¡Hola, Mundo!!! ')).toBe('hola-mundo');
  });

  it('no deja guiones al inicio/fin', () => {
    expect(slugify('---Evento---')).toBe('evento');
  });

  it('slugWithSuffix añade el sufijo', () => {
    expect(slugWithSuffix('Mi Evento', 'ab12')).toBe('mi-evento-ab12');
  });
});
