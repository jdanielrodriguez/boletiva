import { INestApplication } from '@nestjs/common';
import { LedgerService } from '../../modules/ledger/ledger.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp } from './utils';

/**
 * Ola 3 · Ticket 1 — Ledger doble-entrada con hash-chain.
 * Verifica la mecánica contable: transacciones que suman 0, encadenado de hashes
 * inborrable, detección de manipulación, saldos derivados y concurrencia serial.
 */
describe('Ledger doble-entrada + hash-chain (e2e)', () => {
  let app: INestApplication;
  let ledger: LedgerService;
  let prisma: PrismaService;

  // Owners sintéticos (ownerId es uuid libre, sin FK).
  const U1 = '11111111-1111-4111-8111-111111111111';
  const U2 = '22222222-2222-4222-8222-222222222222';

  async function wipeLedger() {
    await prisma.ledgerEntry.deleteMany({});
    await prisma.ledgerTransaction.deleteMany({});
    await prisma.ledgerAccount.deleteMany({});
  }

  beforeAll(async () => {
    app = await createTestApp();
    ledger = app.get(LedgerService);
    prisma = app.get(PrismaService);
    await wipeLedger(); // estado limpio y determinista
  });

  afterAll(async () => {
    await wipeLedger();
    await app.close();
  });

  it('asienta una transacción balanceada y actualiza los saldos', async () => {
    const tx = await ledger.post({
      kind: 'wallet_topup',
      memo: 'recarga de prueba',
      entries: [
        { type: 'user_wallet', ownerId: U1, amount: '100.00' },
        { type: 'gateway_clearing', amount: '-100.00' },
      ],
    });
    expect(tx.hash).toMatch(/^[a-f0-9]{64}$/); // sha256 sellado
    expect(tx.prevHash).toBe(''); // génesis
    expect(tx.entries).toHaveLength(2);
    expect((await ledger.walletBalance(U1)).toFixed(2)).toBe('100.00');
  });

  it('encadena la siguiente transacción (prevHash = hash anterior) e integridad OK', async () => {
    const first = await prisma.ledgerTransaction.findFirstOrThrow({ orderBy: { seq: 'asc' } });
    const tx2 = await ledger.post({
      kind: 'order_payment',
      refType: 'order',
      refId: '33333333-3333-4333-8333-333333333333',
      entries: [
        { type: 'gateway_clearing', amount: '-123.20' },
        { type: 'promoter_payable', ownerId: U2, amount: '100.00' },
        { type: 'platform_revenue', amount: '10.00' },
        { type: 'tax_payable', amount: '13.20' },
      ],
    });
    expect(tx2.prevHash).toBe(first.hash); // encadenado
    const check = await ledger.verifyChain();
    expect(check.ok).toBe(true);
    expect(check.checked).toBe(2);
  });

  it('rechaza una transacción que no suma 0 → 400', async () => {
    await expect(
      ledger.post({
        kind: 'bad',
        entries: [
          { type: 'user_wallet', ownerId: U1, amount: '50.00' },
          { type: 'gateway_clearing', amount: '-40.00' },
        ],
      }),
    ).rejects.toThrow();
  });

  it('rechaza una transacción con menos de 2 asientos → 400', async () => {
    await expect(
      ledger.post({ kind: 'bad', entries: [{ type: 'user_wallet', ownerId: U1, amount: '0.00' }] }),
    ).rejects.toThrow();
  });

  it('concurrencia: 15 posts simultáneos mantienen el chain íntegro (lock serial)', async () => {
    const N = 15;
    await Promise.all(
      Array.from({ length: N }, () =>
        ledger.post({
          kind: 'wallet_topup',
          entries: [
            { type: 'user_wallet', ownerId: U2, amount: '10.00' },
            { type: 'gateway_clearing', amount: '-10.00' },
          ],
        }),
      ),
    );
    const check = await ledger.verifyChain();
    expect(check.ok).toBe(true); // chain continuo pese a la concurrencia
    // seq únicos y correlativos.
    const txs = await prisma.ledgerTransaction.findMany({ orderBy: { seq: 'asc' } });
    expect(txs.length).toBe(2 + N); // 2 previas + N
    const hashes = new Set(txs.map((t) => t.hash));
    expect(hashes.size).toBe(txs.length); // sin colisiones de hash
    expect((await ledger.walletBalance(U2)).toFixed(2)).toBe('150.00'); // 15 * 10
  });

  it('detecta manipulación: alterar un asiento invalida el chain (verifyChain ok:false)', async () => {
    const entry = await prisma.ledgerEntry.findFirstOrThrow();
    await prisma.ledgerEntry.update({ where: { id: entry.id }, data: { amount: '999.99' } });
    const check = await ledger.verifyChain();
    expect(check.ok).toBe(false); // huella rota
    expect(check.brokenAt).toBeDefined();
  });
});
