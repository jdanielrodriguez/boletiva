import { StubFelCertifier } from './stub-fel-certifier';
import { FelInvalidNitError, type FelInvoiceInput } from './fel-certifier.port';

function makeInput(overrides: Partial<FelInvoiceInput> = {}): FelInvoiceInput {
  return {
    emisorNit: '1234567',
    receptorNit: 'CF',
    items: [{ description: 'Entrada', quantity: 1, unitPrice: '100.00', total: '100.00' }],
    currency: 'GTQ',
    total: '100.00',
    iva: '0.00',
    type: 'platform',
    correlationId: 'order-abc',
    ...overrides,
  };
}

describe('StubFelCertifier', () => {
  const stub = new StubFelCertifier();

  it('genera uuid/serie/numero DETERMINISTAS (mismo input → mismo resultado)', async () => {
    const a = await stub.certify(makeInput());
    const b = await stub.certify(makeInput());
    expect(a).toEqual(b);
    expect(a.uuid).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
    expect(a.serie).toMatch(/^[0-9A-F]{8}$/);
    expect(a.numero).toMatch(/^\d{9}$/);
    expect(a.receptorNit).toBe('CF');
  });

  it('inputs distintos (tipo/correlación) → autorizaciones distintas', async () => {
    const platform = await stub.certify(makeInput({ type: 'platform' }));
    const promoter = await stub.certify(makeInput({ type: 'promoter' }));
    const other = await stub.certify(makeInput({ correlationId: 'order-xyz' }));
    expect(platform.uuid).not.toBe(promoter.uuid);
    expect(platform.uuid).not.toBe(other.uuid);
  });

  it("NIT que empieza por 'BAD' → lanza FelInvalidNitError (simula rechazo del SAT)", async () => {
    await expect(stub.certify(makeInput({ receptorNit: 'BAD123' }))).rejects.toBeInstanceOf(
      FelInvalidNitError,
    );
  });
});
