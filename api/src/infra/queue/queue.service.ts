import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import type { JobsOptions } from 'bullmq';
import type { RedisOptions } from 'ioredis';

/** Un handler procesa todos los jobs de una cola, ramificando por `name`. */
export type JobHandler = (name: string, data: unknown) => Promise<void>;

/**
 * Orquestador de colas (BullMQ). Los módulos de features registran su handler por
 * cola (registerHandler) en su init; los workers se levantan una vez que todos los
 * handlers están registrados (onApplicationBootstrap).
 *
 * Dos modos (config `queue.inline`):
 *  - async (dev/prod): `enqueue` empuja el job a BullMQ y RETORNA de inmediato
 *    (no bloquea el event loop ni el webhook de la pasarela; condición del
 *    arquitecto). Los reintentos/fallos los gestiona BullMQ.
 *  - inline (test): `enqueue` ejecuta el handler al instante → E2E deterministas
 *    y sin workers dejando handles abiertos.
 *
 * `enqueue` NUNCA lanza: un fallo al encolar no debe tumbar el flujo que lo dispara
 * (p.ej. el fulfillment de un pago ya asentado en el ledger).
 */
@Injectable()
export class QueueService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly inline: boolean;
  private readonly prefix: string;
  private readonly connection: RedisOptions;
  private readonly handlers = new Map<string, JobHandler>();
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Map<string, Worker>();

  constructor(config: ConfigService) {
    this.inline = config.get<boolean>('queue.inline') ?? false;
    this.prefix = config.get<string>('queue.prefix') ?? 'pe';
    this.connection = this.parseRedis(config.getOrThrow<string>('redis.url'));
  }

  private parseRedis(url: string): RedisOptions {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: parseInt(u.port || '6379', 10),
      username: u.username || undefined,
      password: u.password || undefined,
      // BullMQ exige maxRetriesPerRequest=null en las conexiones de sus clientes.
      maxRetriesPerRequest: null,
    };
  }

  /** Registra el handler de una cola. Lo llaman los servicios de features en su init. */
  registerHandler(queue: string, handler: JobHandler): void {
    this.handlers.set(queue, handler);
    if (!this.inline && !this.queues.has(queue)) {
      this.queues.set(
        queue,
        new Queue(queue, { connection: this.connection, prefix: this.prefix }),
      );
    }
  }

  onApplicationBootstrap(): void {
    if (this.inline) {
      this.logger.log('Colas en modo INLINE (ejecución síncrona; sin workers)');
      return;
    }
    for (const [queue, handler] of this.handlers) {
      const worker = new Worker(queue, (job) => handler(job.name, job.data), {
        connection: this.connection,
        prefix: this.prefix,
        concurrency: 5,
      });
      worker.on('failed', (job, err) =>
        this.logger.error(`Job ${queue}/${job?.name ?? '?'} falló: ${err.message}`),
      );
      this.workers.set(queue, worker);
    }
    this.logger.log(`Colas BullMQ activas: ${[...this.workers.keys()].join(', ') || '(ninguna)'}`);
  }

  /** Encola un job (async) o lo ejecuta al instante (inline). Nunca lanza. */
  async enqueue(queue: string, name: string, data: unknown, opts?: JobsOptions): Promise<void> {
    try {
      if (this.inline) {
        const handler = this.handlers.get(queue);
        if (!handler) {
          this.logger.warn(`Sin handler para la cola ${queue} (job ${name}); se ignora`);
          return;
        }
        await handler(name, data);
        return;
      }
      const q = this.queues.get(queue);
      if (!q) {
        this.logger.warn(`Cola ${queue} no registrada; job ${name} descartado`);
        return;
      }
      await q.add(name, data, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
        ...opts,
      });
    } catch (err) {
      // Visible incluso con el logger de Nest apagado (tests): ayuda a diagnosticar.
      // No se relanza: el flujo disparador (p.ej. pago ya asentado) no debe caer.
      const msg = (err as Error).stack ?? (err as Error).message;
      this.logger.error(`Fallo procesando ${queue}/${name}: ${msg}`);
      if (this.inline) console.error(`[queue:inline] ${queue}/${name} falló:`, err);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.workers.values()].map((w) => w.close().catch(() => undefined)));
    await Promise.all([...this.queues.values()].map((q) => q.close().catch(() => undefined)));
  }
}
