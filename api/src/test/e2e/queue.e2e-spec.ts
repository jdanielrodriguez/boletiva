import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueService } from '../../infra/queue/queue.service';
import { createTestApp } from './utils';

/**
 * Ola 4 · Ticket 0 — Fundación BullMQ (QueueService).
 * En test corre en modo INLINE (jobs síncronos): se valida el registro de
 * handlers, la ejecución al encolar, y que enqueue NUNCA lanza (cola sin handler
 * o handler que revienta) — un fallo al encolar no debe tumbar el flujo disparador.
 */
describe('Colas (QueueService, e2e)', () => {
  let app: INestApplication;
  let queue: QueueService;

  beforeAll(async () => {
    app = await createTestApp();
    queue = app.get(QueueService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('en test está en modo inline (sin workers colgando)', () => {
    const config = app.get(ConfigService);
    expect(config.get<boolean>('queue.inline')).toBe(true);
  });

  it('ejecuta el handler registrado al encolar (inline)', async () => {
    const seen: Array<{ name: string; data: unknown }> = [];
    queue.registerHandler('test-q', async (name, data) => {
      seen.push({ name, data });
    });
    await queue.enqueue('test-q', 'do', { x: 1 });
    expect(seen).toEqual([{ name: 'do', data: { x: 1 } }]);
  });

  it('encolar a una cola sin handler no lanza (se ignora)', async () => {
    await expect(queue.enqueue('cola-inexistente', 'x', {})).resolves.toBeUndefined();
  });

  it('un handler que revienta no propaga el error al que encola', async () => {
    queue.registerHandler('boom-q', async () => {
      throw new Error('fallo del worker');
    });
    await expect(queue.enqueue('boom-q', 'x', {})).resolves.toBeUndefined();
  });
});
