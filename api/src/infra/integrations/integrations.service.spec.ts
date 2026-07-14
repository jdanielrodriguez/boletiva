import { ServiceUnavailableException } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import type { AppConfig } from '../../config/configuration';

/** ConfigService falso: devuelve el sub-árbol de config pedido por clave. */
function makeConfig(overrides: Partial<Record<string, unknown>> = {}) {
  const base: Record<string, unknown> = {
    recurrente: { apiKey: '', apiSecret: '', webhookSecret: '', baseUrl: 'x' },
    pagalo: { credencial: '', dominio: '', estado: 'sandbox', keyPublic: '', keySecret: '', idenEmpresa: '', webhookSecret: '' },
    fel: { certifier: '', apiUser: '', apiKey: '', requestorNit: '', baseUrl: '' },
    wallet: {
      provider: 'stub',
      apple: { passTypeId: '', teamId: '', certP12Base64: '', certPassword: '', wwdrBase64: '' },
      google: { issuerId: '', serviceAccountJson: '' },
    },
    recaptcha: { siteKey: '', secretKey: '', minScore: 0.5, disabled: false },
    oauth: { google: { clientId: '', clientSecret: '' } },
    ...overrides,
  };
  return {
    getOrThrow: <T,>(key: string): T => base[key] as T,
    get: <T,>(key: string): T => base[key] as T,
  } as unknown as import('@nestjs/config').ConfigService;
}

describe('IntegrationsService (capacidades por env)', () => {
  it('sin credenciales: todo NO disponible', () => {
    const svc = new IntegrationsService(makeConfig());
    const caps = svc.capabilities();
    expect(caps).toEqual({
      recurrente: false,
      pagalo: false,
      fel: false,
      appleWallet: false,
      googleWallet: false,
      googleOAuth: false,
      recaptcha: false,
    });
  });

  it('assertAvailable lanza 503 si el servicio no está configurado', () => {
    const svc = new IntegrationsService(makeConfig());
    expect(() => svc.assertAvailable('recurrente')).toThrow(ServiceUnavailableException);
    try {
      svc.assertAvailable('pagalo');
    } catch (e) {
      expect((e as Error).message).toContain('Servicio no disponible');
    }
  });

  it('recurrente disponible con apiKey+apiSecret', () => {
    const svc = new IntegrationsService(
      makeConfig({ recurrente: { apiKey: 'k', apiSecret: 's', webhookSecret: 'w', baseUrl: 'x' } }),
    );
    expect(svc.available('recurrente')).toBe(true);
    expect(() => svc.assertAvailable('recurrente')).not.toThrow();
  });

  it('pagalo exige credencial+dominio+llaves de empresa (value-ready)', () => {
    const partial = new IntegrationsService(
      makeConfig({ pagalo: { credencial: 'CpZX', dominio: 'sandbox.pagalocard.com', estado: 'sandbox', keyPublic: '', keySecret: '', idenEmpresa: '', webhookSecret: '' } }),
    );
    expect(partial.available('pagalo')).toBe(false); // faltan llaves de empresa (GCP)
    const full = new IntegrationsService(
      makeConfig({ pagalo: { credencial: 'CpZX', dominio: 'sandbox.pagalocard.com', estado: 'sandbox', keyPublic: 'pub', keySecret: 'sec', idenEmpresa: 'J456', webhookSecret: 'w' } }),
    );
    expect(full.available('pagalo')).toBe(true);
  });

  it('googleWallet disponible con issuerId + serviceAccountJson', () => {
    const svc = new IntegrationsService(
      makeConfig({
        wallet: {
          provider: 'google',
          apple: { passTypeId: '', teamId: '', certP12Base64: '', certPassword: '', wwdrBase64: '' },
          google: { issuerId: '3388', serviceAccountJson: '{"x":1}' },
        } as AppConfig['wallet'],
      }),
    );
    expect(svc.available('googleWallet')).toBe(true);
    expect(svc.available('appleWallet')).toBe(false);
  });

  it('recaptcha: disponible solo con secret y NO desactivado; desactivado = NO bloquea (available=false)', () => {
    const on = new IntegrationsService(
      makeConfig({ recaptcha: { siteKey: 'pub', secretKey: 'sec', minScore: 0.5, disabled: false } }),
    );
    expect(on.available('recaptcha')).toBe(true);
    const off = new IntegrationsService(
      makeConfig({ recaptcha: { siteKey: 'pub', secretKey: 'sec', minScore: 0.5, disabled: true } }),
    );
    expect(off.available('recaptcha')).toBe(false);
  });

  it('googleOAuth: disponible solo con clientId + clientSecret', () => {
    const partial = new IntegrationsService(
      makeConfig({ oauth: { google: { clientId: 'abc.apps.googleusercontent.com', clientSecret: '' } } }),
    );
    expect(partial.available('googleOAuth')).toBe(false);
    const full = new IntegrationsService(
      makeConfig({ oauth: { google: { clientId: 'abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-xxx' } } }),
    );
    expect(full.available('googleOAuth')).toBe(true);
  });
});
