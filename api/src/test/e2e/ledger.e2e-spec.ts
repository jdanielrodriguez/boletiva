import { INestApplication } from '@nestjs/common';
import Decimal from 'decimal.js';
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

  const ORDER_ID = '33333333-3333-4333-8333-333333333333';

  it('orderChain: devuelve la cadena de una orden y la marca verificada', async () => {
    const chain = await ledger.orderChain(ORDER_ID);
    expect(chain.orderId).toBe(ORDER_ID);
    expect(chain.transactions).toHaveLength(1);
    expect(chain.transactions[0].kind).toBe('order_payment');
    expect(chain.transactions[0].verified).toBe(true); // hash recomputado coincide
    expect(chain.transactions[0].seq).toMatch(/^\d+$/);
    expect(chain.chainValid).toBe(true);
  });

  it('orderChain: una orden sin movimientos devuelve cadena vacía', async () => {
    const chain = await ledger.orderChain('99999999-9999-4999-8999-999999999999');
    expect(chain.transactions).toEqual([]);
  });

  it('orderChain: marca verified=false si el hash de la transacción fue alterado', async () => {
    const tx = await prisma.ledgerTransaction.findFirstOrThrow({
      where: { refType: 'order', refId: ORDER_ID },
    });
    const original = tx.hash;
    await prisma.ledgerTransaction.update({ where: { id: tx.id }, data: { hash: '0'.repeat(64) } });
    try {
      const chain = await ledger.orderChain(ORDER_ID);
      expect(chain.transactions[0].verified).toBe(false); // hash recomputado NO coincide
      expect(chain.chainValid).toBe(false); // la cadena global también rompe
    } finally {
      await prisma.ledgerTransaction.update({ where: { id: tx.id }, data: { hash: original } });
    }
    expect((await ledger.verifyChain()).ok).toBe(true); // restaurado
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

  it('rechaza una cuenta de usuario sin ownerId → 400', async () => {
    await expect(
      ledger.post({
        kind: 'bad',
        entries: [
          { type: 'user_wallet', amount: '10.00' }, // falta ownerId → BadRequest
          { type: 'gateway_clearing', amount: '-10.00' },
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

  it('detecta manipulación: alterar el HASH de una transacción rompe el chain', async () => {
    // El chain está íntegro (tests previos). Corrompemos SOLO el hash de la última
    // transacción (entries y prevHash intactos): sumará 0 y encadenará bien, pero el
    // hash recomputado no coincidirá → verifyChain debe fallar en ESA tx (línea 188).
    const last = await prisma.ledgerTransaction.findFirstOrThrow({ orderBy: { seq: 'desc' } });
    const originalHash = last.hash;
    await prisma.ledgerTransaction.update({
      where: { id: last.id },
      data: { hash: '0'.repeat(64) }, // hash con formato válido pero incorrecto
    });
    try {
      const check = await ledger.verifyChain();
      expect(check.ok).toBe(false);
      expect(check.brokenAt).toBe(last.id);
    } finally {
      await prisma.ledgerTransaction.update({
        where: { id: last.id },
        data: { hash: originalHash }, // restaura para no ensuciar tests posteriores
      });
    }
    // Restaurado: el chain vuelve a estar íntegro.
    expect((await ledger.verifyChain()).ok).toBe(true);
  });

  it('detecta manipulación: un SALDO cacheado que no cuadra con sus asientos', async () => {
    // Chain de transacciones íntegro; corrompemos el balance cacheado de una cuenta
    // para que difiera de la suma de sus asientos → verifyChain lo detecta (línea 201).
    const acc = await prisma.ledgerAccount.findFirstOrThrow();
    const originalBalance = acc.balance.toString();
    await prisma.ledgerAccount.update({
      where: { id: acc.id },
      data: { balance: new Decimal(originalBalance).add(1).toFixed(2) },
    });
    try {
      const check = await ledger.verifyChain();
      expect(check.ok).toBe(false);
      expect(check.brokenAt).toBe(acc.id);
    } finally {
      await prisma.ledgerAccount.update({
        where: { id: acc.id },
        data: { balance: originalBalance },
      });
    }
    expect((await ledger.verifyChain()).ok).toBe(true);
  });

  it('detecta manipulación: alterar un asiento invalida el chain (verifyChain ok:false)', async () => {
    const entry = await prisma.ledgerEntry.findFirstOrThrow();
    await prisma.ledgerEntry.update({ where: { id: entry.id }, data: { amount: '999.99' } });
    const check = await ledger.verifyChain();
    expect(check.ok).toBe(false); // huella rota
    expect(check.brokenAt).toBeDefined();
  });
});
