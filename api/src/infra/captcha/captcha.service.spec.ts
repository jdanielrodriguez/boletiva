import { ConfigService } from '@nestjs/config';
import { CaptchaService } from './captcha.service';
import { IntegrationsService } from '../integrations/integrations.service';

/** ConfigService falso: solo devuelve el sub-árbol `recaptcha`. */
function makeConfig(minScore = 0.5): ConfigService {
  return {
    getOrThrow: () => ({ siteKey: 'pub', secretKey: 'sec', minScore, disabled: false }),
  } as unknown as ConfigService;
}

/** IntegrationsService falso: available('recaptcha') = `on`. */
function makeIntegrations(on: boolean): IntegrationsService {
  return { available: () => on } as unknown as IntegrationsService;
}

/** Mockea global.fetch con una respuesta siteverify. */
function mockFetch(payload: unknown): jest.Mock {
  const fn = jest.fn().mockResolvedValue({ json: async () => payload });
  (global as unknown as { fetch: unknown }).fetch = fn;
  return fn;
}

describe('CaptchaService', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    (global as unknown as { fetch: unknown }).fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('integración no disponible → OMITE la verificación (true) y NO llama a Google', async () => {
    const fetchFn = mockFetch({ success: true });
    const svc = new CaptchaService(makeConfig(), makeIntegrations(false));

    await expect(svc.verify('cualquier-token', 'login')).resolves.toBe(true);
    await expect(svc.verify('', 'login')).resolves.toBe(true); // sin token tampoco bloquea
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('disponible + siteverify success con score suficiente → true', async () => {
    const fetchFn = mockFetch({ success: true, score: 0.9, action: 'login' });
    const svc = new CaptchaService(makeConfig(0.5), makeIntegrations(true));

    await expect(svc.verify('tok', 'login', '1.2.3.4')).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    // Envía secret, response y remoteip como form.
    const body = (fetchFn.mock.calls[0][1] as { body: string }).body;
    expect(body).toContain('secret=sec');
    expect(body).toContain('response=tok');
    expect(body).toContain('remoteip=1.2.3.4');
  });

  it('disponible pero token vacío → false (no llama a Google)', async () => {
    const fetchFn = mockFetch({ success: true, score: 0.9 });
    const svc = new CaptchaService(makeConfig(), makeIntegrations(true));

    await expect(svc.verify('', 'login')).resolves.toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('success=false → false', async () => {
    mockFetch({ success: false, 'error-codes': ['invalid-input-response'] });
    const svc = new CaptchaService(makeConfig(), makeIntegrations(true));

    await expect(svc.verify('tok', 'login')).resolves.toBe(false);
  });

  it('score por debajo del mínimo → false', async () => {
    mockFetch({ success: true, score: 0.2, action: 'login' });
    const svc = new CaptchaService(makeConfig(0.5), makeIntegrations(true));

    await expect(svc.verify('tok', 'login')).resolves.toBe(false);
  });

  it('acción distinta a la esperada → false', async () => {
    mockFetch({ success: true, score: 0.9, action: 'otra' });
    const svc = new CaptchaService(makeConfig(0.5), makeIntegrations(true));

    await expect(svc.verify('tok', 'login')).resolves.toBe(false);
  });

  it('fallo de red al verificar → false (no abre la puerta)', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('network down'));
    (global as unknown as { fetch: unknown }).fetch = fn;
    const svc = new CaptchaService(makeConfig(), makeIntegrations(true));

    await expect(svc.verify('tok', 'login')).resolves.toBe(false);
  });
});
