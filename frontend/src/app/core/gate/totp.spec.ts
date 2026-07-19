import { parseQr, verifyTotp } from './totp';

/**
 * Validación TOTP offline: DEBE casar con el backend (otplib authenticator: HMAC-SHA1,
 * paso 30 s, 6 dígitos, ventana ±1). Se prueba con vectores oficiales RFC 6238 (semilla
 * ASCII "12345678901234567890" = base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ).
 */
describe('verifyTotp (offline SafeTix)', () => {
  const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  it('acepta el código correcto del paso actual (RFC 6238, T=59 → 287082)', async () => {
    expect(await verifyTotp(SECRET, '287082', 59_000)).toBe(true);
  });

  it('acepta otro vector RFC (T=1111111109 → 081804)', async () => {
    expect(await verifyTotp(SECRET, '081804', 1_111_111_109_000)).toBe(true);
  });

  it('rechaza un código incorrecto', async () => {
    expect(await verifyTotp(SECRET, '000000', 59_000)).toBe(false);
  });

  it('tolera desfase de ±1 paso (ventana), pero no de 3 pasos', async () => {
    expect(await verifyTotp(SECRET, '287082', (59 + 30) * 1000)).toBe(true); // +1 paso
    expect(await verifyTotp(SECRET, '287082', (59 + 90) * 1000)).toBe(false); // +3 pasos
  });

  it('rechaza formato inválido (no 6 dígitos)', async () => {
    expect(await verifyTotp(SECRET, '12ab56', 59_000)).toBe(false);
    expect(await verifyTotp(SECRET, '123', 59_000)).toBe(false);
  });
});

describe('parseQr', () => {
  it('parsea PE1.<serial>.<6 dígitos>', () => {
    expect(parseQr('PE1.PEABC123.045678')).toEqual({ serial: 'PEABC123', code: '045678' });
  });

  it('rechaza prefijo/formato inválidos', () => {
    expect(parseQr('XX1.PEABC.123456')).toBeNull();
    expect(parseQr('PE1.PEABC.12ab56')).toBeNull();
    expect(parseQr('PE1..123456')).toBeNull();
    expect(parseQr('PE1.PEABC.123456.extra')).toBeNull();
  });
});
