import { PaymentProviderRegistry } from './payment-provider.registry';

/** Enrutamiento multi-pasarela: modo FORZADO (env) vs AUTO (por gateway) + fallback. */
describe('PaymentProviderRegistry', () => {
  const sim = { name: 'simulator' } as never;
  const rec = { name: 'recurrente' } as never;
  const pag = { name: 'pagalo' } as never;
  const mk = (providerCfg: string) =>
    new PaymentProviderRegistry({ get: () => providerCfg } as never, sim, rec, pag);

  it("forzado 'simulator' → SIEMPRE simulador (ignora el gateway)", () => {
    const r = mk('simulator');
    expect(r.resolveFor({ provider: 'pagalo' }).name).toBe('simulator');
    expect(r.resolveFor({ provider: 'recurrente' }).name).toBe('simulator');
    expect(r.resolveFor(null).name).toBe('simulator');
  });

  it("'auto' → enruta por el provider del gateway", () => {
    const r = mk('auto');
    expect(r.resolveFor({ provider: 'pagalo' }).name).toBe('pagalo');
    expect(r.resolveFor({ provider: 'recurrente' }).name).toBe('recurrente');
    expect(r.resolveFor({ provider: 'simulator' }).name).toBe('simulator');
  });

  it("'auto' + provider desconocido/nulo → fallback simulador", () => {
    const r = mk('auto');
    expect(r.resolveFor({ provider: 'dlocal' }).name).toBe('simulator'); // no registrado
    expect(r.resolveFor(null).name).toBe('simulator');
    expect(r.resolveFor({ provider: null }).name).toBe('simulator');
  });

  it("forzado a un provider real gana sobre el gateway", () => {
    const r = mk('pagalo');
    expect(r.resolveFor({ provider: 'recurrente' }).name).toBe('pagalo');
  });
});
