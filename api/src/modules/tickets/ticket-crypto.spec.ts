import { ConfigService } from '@nestjs/config';
import { TicketCryptoService, TicketIdentity } from './ticket-crypto.service';
import { TicketSigningService } from './ticket-signing.service';

/**
 * Unit — criptografía del boleto (sin BD). Cubre las ramas puras: parseo del QR,
 * mensaje canónico de identidad (incl. admisión general), TOTP rotativo, y la
 * firma Ed25519 (roundtrip, firma corrupta, llave pública PEM para validadores).
 */
describe('TicketCryptoService (unit)', () => {
  const crypto = new TicketCryptoService();

  describe('parseQr', () => {
    it('acepta un valor bien formado PE1.<serial>.<6 dígitos>', () => {
      expect(crypto.parseQr('PE1.PEABC123.045678')).toEqual({
        serial: 'PEABC123',
        code: '045678',
      });
    });

    it.each([
      ['prefijo inválido', 'XX.PEABC.123456'],
      ['serial vacío', 'PE1..123456'],
      ['código no numérico', 'PE1.PEABC.12ab56'],
      ['código de menos de 6 dígitos', 'PE1.PEABC.123'],
      ['partes de más', 'PE1.PEABC.123456.extra'],
      ['cadena vacía', ''],
      ['sin puntos', 'noesunqr'],
    ])('rechaza (%s) → null', (_label, payload) => {
      expect(crypto.parseQr(payload)).toBeNull();
    });
  });

  describe('identityMessage', () => {
    const base: TicketIdentity = {
      id: 'id-1',
      serial: 'PEX',
      eventId: 'ev-1',
      localityId: 'loc-1',
      seatId: 'seat-1',
      ownerId: 'own-1',
    };

    it('incluye el seatId cuando hay asiento', () => {
      expect(crypto.identityMessage(base)).toBe('PE-TKT-v1|id-1|PEX|ev-1|loc-1|seat-1|own-1');
    });

    it('usa "GA" para admisión general (seatId null)', () => {
      expect(crypto.identityMessage({ ...base, seatId: null })).toBe(
        'PE-TKT-v1|id-1|PEX|ev-1|loc-1|GA|own-1',
      );
    });
  });

  describe('TOTP rotativo', () => {
    it('genera y verifica su propio código (ventana actual)', () => {
      const secret = crypto.newTotpSecret();
      const code = crypto.rotatingCode(secret);
      expect(code).toMatch(/^\d{6}$/);
      expect(crypto.verifyRotatingCode(code, secret)).toBe(true);
    });

    it('rechaza un código ajeno y no revienta con secreto inválido', () => {
      const secret = crypto.newTotpSecret();
      expect(crypto.verifyRotatingCode('000000', secret)).toBe(false);
      expect(crypto.verifyRotatingCode('123456', 'secreto-no-base32!!')).toBe(false);
    });
  });
});

describe('TicketSigningService (unit)', () => {
  const cfg = {
    getOrThrow: (key: string) =>
      ({
        'tickets.signingSeed': '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
        'tickets.signingKeyId': 'test-key-1',
      }[key]),
  } as unknown as ConfigService;
  const signing = new TicketSigningService(cfg);

  it('firma y verifica el mismo mensaje (roundtrip)', () => {
    const msg = 'PE-TKT-v1|abc';
    const sig = signing.sign(msg);
    expect(sig.length).toBeGreaterThan(0);
    expect(signing.verify(msg, sig)).toBe(true);
  });

  it('rechaza si el mensaje cambió (anti-manipulación)', () => {
    const sig = signing.sign('mensaje-original');
    expect(signing.verify('mensaje-alterado', sig)).toBe(false);
  });

  it('verify devuelve false (no lanza) con firma base64 corrupta', () => {
    expect(signing.verify('m', 'no-es-base64-válido-@@@')).toBe(false);
    expect(signing.verify('m', '')).toBe(false);
  });

  it('expone la llave pública en PEM (SPKI) y el keyId configurado', () => {
    expect(signing.keyId).toBe('test-key-1');
    const pem = signing.publicKeyPem();
    expect(pem).toContain('-----BEGIN PUBLIC KEY-----');
    expect(pem).toContain('-----END PUBLIC KEY-----');
  });

  it('mismo seed ⇒ misma llave (determinista, verificación cruzada)', () => {
    const other = new TicketSigningService(cfg);
    const sig = signing.sign('cross');
    expect(other.verify('cross', sig)).toBe(true); // otra instancia, mismo seed
  });
});
