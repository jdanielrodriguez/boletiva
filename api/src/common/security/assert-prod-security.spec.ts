import { assertProductionSecurity } from './assert-prod-security';

/** ConfigService falso: devuelve valores de un mapa por clave. */
function cfg(map: Record<string, unknown>) {
  return { get: <T>(k: string): T => map[k] as T } as unknown as import('@nestjs/config').ConfigService;
}

const SECURE: Record<string, unknown> = {
  isProd: true,
  'jwt.accessSecret': 'real-access-xyz',
  'jwt.refreshSecret': 'real-refresh-xyz',
  'security.encryptionKey': 'aa'.repeat(32),
  'payment.webhookSecret': 'real-webhook-xyz',
  'tickets.signingSeed': 'bb'.repeat(32),
  'security.trustProxy': 1,
  'cors.origins': ['https://boletiva.com'],
  'payment.provider': 'recurrente', // prod exige pasarela real (no simulador)
  recaptcha: { disabled: false, secretKey: 'real-recaptcha-secret' }, // prod exige captcha activo
};

describe('assertProductionSecurity (guard de arranque)', () => {
  it('no hace nada fuera de producción', () => {
    expect(() => assertProductionSecurity(cfg({ isProd: false }))).not.toThrow();
  });

  it('config de prod segura → no lanza', () => {
    expect(() => assertProductionSecurity(cfg(SECURE))).not.toThrow();
  });

  it('C1: un secreto con el default de dev → aborta', () => {
    expect(() =>
      assertProductionSecurity(cfg({ ...SECURE, 'payment.webhookSecret': 'dev-webhook-secret-change-me' })),
    ).toThrow(/producción/i);
    expect(() =>
      assertProductionSecurity(cfg({ ...SECURE, 'jwt.accessSecret': 'dev-access-secret-change-me' })),
    ).toThrow();
    expect(() =>
      assertProductionSecurity(
        cfg({ ...SECURE, 'security.encryptionKey': '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08' }),
      ),
    ).toThrow();
  });

  it('C2/H3: trust proxy true/false/no-entero → aborta; entero ≥1 → ok', () => {
    expect(() => assertProductionSecurity(cfg({ ...SECURE, 'security.trustProxy': true }))).toThrow();
    expect(() => assertProductionSecurity(cfg({ ...SECURE, 'security.trustProxy': false }))).toThrow();
    expect(() => assertProductionSecurity(cfg({ ...SECURE, 'security.trustProxy': 0 }))).toThrow();
    expect(() => assertProductionSecurity(cfg({ ...SECURE, 'security.trustProxy': 'loopback' }))).toThrow();
    expect(() => assertProductionSecurity(cfg({ ...SECURE, 'security.trustProxy': 2 }))).not.toThrow();
  });

  it('M5: CORS con "*" en prod → aborta', () => {
    expect(() => assertProductionSecurity(cfg({ ...SECURE, 'cors.origins': ['*'] }))).toThrow();
  });

  it('QA: PAYMENT_PROVIDER simulador en prod → aborta (cobraría de mentira)', () => {
    expect(() => assertProductionSecurity(cfg({ ...SECURE, 'payment.provider': 'simulator' }))).toThrow();
    // sin proveedor configurado cae al default 'simulator' → también aborta
    const { ['payment.provider']: _omit, ...noProvider } = SECURE;
    void _omit;
    expect(() => assertProductionSecurity(cfg(noProvider))).toThrow();
  });

  it('QA: reCAPTCHA deshabilitado o sin secret en prod → aborta (falla-abierto anti-bot)', () => {
    expect(() =>
      assertProductionSecurity(cfg({ ...SECURE, recaptcha: { disabled: true, secretKey: 'x' } })),
    ).toThrow();
    expect(() =>
      assertProductionSecurity(cfg({ ...SECURE, recaptcha: { disabled: false, secretKey: '' } })),
    ).toThrow();
    const { recaptcha: _rc, ...noRc } = SECURE;
    void _rc;
    expect(() => assertProductionSecurity(cfg(noRc))).toThrow();
  });
});
