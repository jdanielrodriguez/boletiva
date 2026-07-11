import { DevicesService } from './devices.service';
import { sha256 } from '../../common/utils/crypto';

/**
 * Huella estable del dispositivo (`hash`): prioriza el header X-Device-Id y, en su
 * ausencia, cae a userAgent|ip. Es pura (no toca la BD), así que se prueba en
 * aislamiento — es la base del 2FA por dispositivo confiable.
 */
describe('DevicesService.hash (huella del dispositivo)', () => {
  const service = new DevicesService({} as never);

  it('usa X-Device-Id (trim) cuando viene', () => {
    expect(service.hash({ deviceId: '  dev-123  ' })).toBe(sha256('dev-123'));
  });

  it('sin deviceId cae al fallback userAgent|ip', () => {
    expect(service.hash({ userAgent: 'UA/1.0', ip: '1.2.3.4' })).toBe(sha256('UA/1.0|1.2.3.4'));
  });

  it('deviceId vacío (solo espacios) también cae al fallback', () => {
    expect(service.hash({ deviceId: '   ', userAgent: 'UA', ip: '9.9.9.9' })).toBe(sha256('UA|9.9.9.9'));
  });

  it('sin UA ni IP el fallback usa cadenas vacías (nunca undefined)', () => {
    expect(service.hash({})).toBe(sha256('|'));
  });

  it('la misma identidad produce el mismo hash (determinista)', () => {
    const ctx = { userAgent: 'UA', ip: '5.5.5.5' };
    expect(service.hash(ctx)).toBe(service.hash(ctx));
  });
});
