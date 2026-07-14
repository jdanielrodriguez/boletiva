import { HealthService } from './health.service';

const up = () => Promise.resolve(true);
const down = () => Promise.resolve(false);
const boom = () => Promise.reject(new Error('conn refused'));

const caps = {
  recurrente: false,
  pagalo: false,
  fel: false,
  appleWallet: false,
  googleWallet: true,
  googleOAuth: false,
  recaptcha: false,
};

function build(overrides: Partial<Record<string, () => Promise<boolean>>> = {}) {
  const pings = { postgres: up, redis: up, mail: up, storage: up, rabbit: up, ...overrides };
  return new HealthService(
    { ping: pings.postgres } as any,
    { ping: pings.redis } as any,
    { ping: pings.mail } as any,
    { ping: pings.storage } as any,
    { ping: pings.rabbit } as any,
    { capabilities: () => caps } as any,
  );
}

describe('HealthService', () => {
  it('reporta status "ok" cuando todas las dependencias responden', async () => {
    const report = await build().check();
    expect(report.status).toBe('ok');
    expect(Object.keys(report.checks)).toEqual([
      'postgres',
      'redis',
      'mail',
      'storage',
      'rabbitmq',
    ]);
    expect(report.checks.postgres.ok).toBe(true);
    expect(typeof report.checks.postgres.latencyMs).toBe('number');
    expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
    // Las integraciones se reportan pero NO afectan el status.
    expect(report.integrations).toEqual(caps);
  });

  it('reporta las capacidades de integraciones sin afectar el status', async () => {
    const report = await build().check();
    expect(report.status).toBe('ok');
    expect(report.integrations.googleWallet).toBe(true);
    expect(report.integrations.recaptcha).toBe(false);
  });

  it('reporta status "error" si una dependencia devuelve false', async () => {
    const report = await build({ redis: down }).check();
    expect(report.status).toBe('error');
    expect(report.checks.redis.ok).toBe(false);
    expect(report.checks.postgres.ok).toBe(true);
  });

  it('captura la excepción de un ping y la expone como detalle', async () => {
    const report = await build({ postgres: boom }).check();
    expect(report.status).toBe('error');
    expect(report.checks.postgres.ok).toBe(false);
    expect(report.checks.postgres.detail).toBe('conn refused');
  });
});
