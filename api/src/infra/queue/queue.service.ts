import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import type { JobsOptions } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { RabbitService } from '../messaging/rabbit.service';
import { RABBIT_QUEUES } from './queue.constants';

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
  // Varios handlers por cola: cada job se despacha a TODOS los handlers de su cola;
  // cada handler procesa los `name` que reconoce e IGNORA en silencio el resto
  // (p.ej. la cola MAIL la comparten confirmación de compra y avisos de promotor).
  private readonly handlers = new Map<string, JobHandler[]>();
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Map<string, Worker>();

  constructor(
    config: ConfigService,
    private readonly rabbit: RabbitService,
  ) {
    this.inline = config.get<boolean>('queue.inline') ?? false;
    this.prefix = config.get<string>('queue.prefix') ?? 'pe';
    this.connection = this.parseRedis(config.getOrThrow<string>('redis.url'));
  }

  /** ¿La cola viaja por RabbitMQ? (en inline todas corren síncronas, sin backend). */
  private isRabbit(queue: string): boolean {
    return !this.inline && queue in RABBIT_QUEUES;
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

  /** Registra un handler de una cola (se acumulan). Lo llaman los servicios en su init. */
  registerHandler(queue: string, handler: JobHandler): void {
    const list = this.handlers.get(queue) ?? [];
    list.push(handler);
    this.handlers.set(queue, list);
    // Las colas de RabbitMQ no necesitan objeto Queue de BullMQ (se publican directo).
    if (!this.inline && !this.isRabbit(queue) && !this.queues.has(queue)) {
      this.queues.set(
        queue,
        new Queue(queue, { connection: this.connection, prefix: this.prefix }),
      );
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.inline) {
      this.logger.log('Colas en modo INLINE (ejecución síncrona; sin workers)');
      return;
    }
    for (const [queue, list] of this.handlers) {
      if (this.isRabbit(queue)) {
        // Consumidor RabbitMQ en canal dedicado (prefetch por cola: settlement=1).
        const { prefetch } = RABBIT_QUEUES[queue];
        await this.rabbit
          .consume<{ name: string; data: unknown }>(
            queue,
            (msg) => this.dispatch(list, msg.name, msg.data),
            prefetch,
          )
          .catch((err) =>
            this.logger.error(`No se pudo activar el consumidor RabbitMQ ${queue}: ${(err as Error).message}`),
          );
        continue;
      }
      const worker = new Worker(queue, (job) => this.dispatch(list, job.name, job.data), {
        connection: this.connection,
        prefix: this.prefix,
        concurrency: 5,
      });
      worker.on('failed', (job, err) =>
        this.logger.error(`Job ${queue}/${job?.name ?? '?'} falló: ${err.message}`),
      );
      this.workers.set(queue, worker);
    }
    this.logger.log(
      `Colas BullMQ: ${[...this.workers.keys()].join(', ') || '(ninguna)'} · RabbitMQ: ${Object.keys(RABBIT_QUEUES).filter((q) => this.handlers.has(q)).join(', ') || '(ninguna)'}`,
    );
  }

  /** Encola un job (async) o lo ejecuta al instante (inline). Nunca lanza. */
  async enqueue(queue: string, name: string, data: unknown, opts?: JobsOptions): Promise<void> {
    try {
      if (this.inline) {
        // Un job DIFERIDO (delay>0) está programado para el futuro; ejecutarlo al
        // instante en modo inline es incorrecto (p.ej. un chequeo de SLA que aún no
        // vence y se re-agendaría en bucle). En tests se dispara a mano cuando toca.
        if (opts?.delay && opts.delay > 0) return;
        const list = this.handlers.get(queue);
        if (!list?.length) {
          this.logger.warn(`Sin handler para la cola ${queue} (job ${name}); se ignora`);
          return;
        }
        await this.dispatch(list, name, data);
        return;
      }
      if (this.isRabbit(queue)) {
        // RabbitMQ no soporta delay nativo; ninguna cola-Rabbit lo usa (solo SUPPORT,
        // que sigue en BullMQ). Si llegara uno, se publica igual (best-effort) con aviso.
        if (opts?.delay && opts.delay > 0) {
          this.logger.warn(`Cola RabbitMQ ${queue} no soporta delay; ${name} se publica sin retardo`);
        }
        await this.rabbit.publish(queue, { name, data });
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

  /** Ejecuta secuencialmente todos los handlers de una cola para un job. */
  private async dispatch(list: JobHandler[], name: string, data: unknown): Promise<void> {
    for (const handler of list) {
      await handler(name, data);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.workers.values()].map((w) => w.close().catch(() => undefined)));
    await Promise.all([...this.queues.values()].map((q) => q.close().catch(() => undefined)));
  }
}
