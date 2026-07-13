import { formatEventDate, mailStrings, resolveMailLocale } from './mail-i18n';

describe('mail-i18n (F3)', () => {
  it('resolveMailLocale normaliza al locale soportado (fallback es)', () => {
    expect(resolveMailLocale('en')).toBe('en');
    expect(resolveMailLocale('EN')).toBe('en');
    expect(resolveMailLocale('en-US')).toBe('en');
    expect(resolveMailLocale('en_us')).toBe('en');
    expect(resolveMailLocale('es')).toBe('es');
    expect(resolveMailLocale('es-GT')).toBe('es');
    expect(resolveMailLocale('fr')).toBe('es'); // no soportado → fallback
    expect(resolveMailLocale('')).toBe('es');
    expect(resolveMailLocale(null)).toBe('es');
    expect(resolveMailLocale(undefined)).toBe('es');
  });

  it('mailStrings devuelve el paquete del locale', () => {
    expect(mailStrings('en').order.title).toBe('Purchase confirmed!');
    expect(mailStrings('es').order.title).toBe('¡Compra confirmada!');
  });

  it('formatEventDate usa America/Guatemala y el sufijo por locale', () => {
    const d = new Date('2026-08-15T02:00:00.000Z');
    expect(formatEventDate(d, 'es')).toContain('(hora de Guatemala)');
    expect(formatEventDate(d, 'en')).toContain('(Guatemala time)');
  });
});
