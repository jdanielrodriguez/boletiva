import { DevicesService } from './devices.service';
import { sha256 } from '../../common/utils/crypto';

/**
 * Huella estable del dispositivo (`hash`): prioriza el id explícito (X-Device-Id o
 * cookie estable `device_id`) y, en su ausencia, cae a SOLO el User-Agent. La IP se
 * excluye a propósito por volátil (así el mismo navegador no se ve como nuevo y no
 * se repite 2FA). Es pura (no toca la BD) → se prueba en aislamiento.
 */
describe('DevicesService.hash (huella del dispositivo)', () => {
  const service = new DevicesService({} as never);

  it('usa el id explícito (trim) cuando viene', () => {
    expect(service.hash({ deviceId: '  dev-123  ' })).toBe(sha256('dev-123'));
  });

  it('sin deviceId cae al fallback SOLO userAgent (sin IP)', () => {
    expect(service.hash({ userAgent: 'UA/1.0', ip: '1.2.3.4' })).toBe(sha256('ua:UA/1.0'));
  });

  it('la IP volátil NO cambia la huella: mismo UA, distinta IP → mismo hash', () => {
    expect(service.hash({ userAgent: 'UA/1.0', ip: '1.2.3.4' })).toBe(
      service.hash({ userAgent: 'UA/1.0', ip: '9.9.9.9' }),
    );
  });

  it('deviceId vacío (solo espacios) también cae al fallback', () => {
    expect(service.hash({ deviceId: '   ', userAgent: 'UA', ip: '9.9.9.9' })).toBe(sha256('ua:UA'));
  });

  it('sin UA el fallback usa cadena vacía (nunca undefined)', () => {
    expect(service.hash({})).toBe(sha256('ua:'));
  });

  it('la misma identidad produce el mismo hash (determinista)', () => {
    const ctx = { userAgent: 'UA', ip: '5.5.5.5' };
    expect(service.hash(ctx)).toBe(service.hash(ctx));
  });
});
