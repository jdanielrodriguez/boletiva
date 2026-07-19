import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { GateDb } from './gate-db';

/**
 * Cubre la RESILIENCIA de la cola offline (store-and-forward): allQueued devuelve el id de
 * cada check-in y deleteQueued borra SOLO los confirmados. Esto garantiza que si se encolan
 * nuevos check-ins MIENTRAS se drena un lote, NO se pierden (a diferencia de un clear()).
 * Usa IndexedDB real (headless Chrome).
 */
describe('GateDb (cola offline resiliente)', () => {
  let db: GateDb;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), GateDb] });
    db = TestBed.inject(GateDb);
    await db.clearQueue();
  });

  afterEach(async () => {
    await db.clearQueue();
  });

  it('enqueue asigna id incremental y allQueued lo devuelve', async () => {
    await db.enqueue({ serial: 'PE-A', at: '2028-01-01T00:00:00Z' });
    await db.enqueue({ serial: 'PE-B', at: '2028-01-01T00:00:01Z' });
    const rows = await db.allQueued();
    expect(rows.length).toBe(2);
    expect(rows.every((r) => typeof r.id === 'number')).toBe(true);
    expect(rows.map((r) => r.serial).sort()).toEqual(['PE-A', 'PE-B']);
  });

  it('deleteQueued borra SOLO los ids indicados (idempotente, por lotes)', async () => {
    await db.enqueue({ serial: 'PE-A', at: 't1' });
    await db.enqueue({ serial: 'PE-B', at: 't2' });
    await db.enqueue({ serial: 'PE-C', at: 't3' });
    const rows = await db.allQueued();
    const ids = rows.map((r) => r.id!).slice(0, 2); // "confirmados": los 2 primeros
    await db.deleteQueued(ids);
    const rest = await db.allQueued();
    expect(rest.length).toBe(1);
    // Reejecutar el mismo delete no rompe (idempotente).
    await db.deleteQueued(ids);
    expect((await db.allQueued()).length).toBe(1);
  });

  it('NO pierde check-ins encolados durante el drenaje (clave anti-pérdida)', async () => {
    // Simula: leo el lote (A,B), llega C mientras "subo", confirmo SOLO A,B.
    await db.enqueue({ serial: 'PE-A', at: 't1' });
    await db.enqueue({ serial: 'PE-B', at: 't2' });
    const batch = await db.allQueued(); // [A, B]
    await db.enqueue({ serial: 'PE-C', at: 't3' }); // llega DURANTE el flush
    await db.deleteQueued(batch.map((r) => r.id!));
    const rest = await db.allQueued();
    expect(rest.map((r) => r.serial)).toEqual(['PE-C']); // C sobrevive
  });
});
