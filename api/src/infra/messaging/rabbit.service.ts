import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'net';
import * as amqp from 'amqplib';

/**
 * RabbitMQ — bus para la validación masiva (fan-in de escaneos en puerta, Ola 6).
 * `ping` (TCP) para el health-check + publicación/consumo con amqplib (cola durable).
 * La conexión es perezosa: solo se abre al primer publish/consume (en modo inline
 * de tests no se abre nunca).
 */
@Injectable()
export class RabbitService implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitService.name);
  private connection?: amqp.ChannelModel;
  private channel?: amqp.Channel;
  private connecting?: Promise<amqp.ChannelModel>;
  /** Canales dedicados de cada consumidor (uno por cola) → prefetch independiente. */
  private readonly consumerChannels: amqp.Channel[] = [];

  constructor(private readonly config: ConfigService) {}

  private parseHostPort(): { host: string; port: number } {
    const url = new URL(this.config.getOrThrow<string>('amqp.url'));
    return { host: url.hostname, port: Number(url.port) || 5672 };
  }

  /** Verificación de conectividad (TCP) para el health-check. */
  ping(timeoutMs = 3000): Promise<boolean> {
    const { host, port } = this.parseHostPort();
    return new Promise<boolean>((resolve) => {
      const socket = new Socket();
      const done = (ok: boolean) => {
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
      socket.connect(port, host);
    });
  }

  /** Conexión AMQP (perezosa, single-flight). */
  private async getConnection(): Promise<amqp.ChannelModel> {
    if (this.connection) return this.connection;
    if (!this.connecting) {
      this.connecting = (async () => {
        const url = this.config.getOrThrow<string>('amqp.url');
        this.connection = await amqp.connect(url);
        this.logger.log('Conexión RabbitMQ abierta');
        return this.connection;
      })();
    }
    return this.connecting;
  }

  /** Canal COMPARTIDO para publicar (perezoso). */
  private async getChannel(): Promise<amqp.Channel> {
    if (this.channel) return this.channel;
    const conn = await this.getConnection();
    this.channel = await conn.createChannel();
    return this.channel;
  }

  /** Publica un mensaje JSON en una cola durable. */
  async publish(queue: string, message: unknown): Promise<void> {
    const ch = await this.getChannel();
    await ch.assertQueue(queue, { durable: true });
    ch.sendToQueue(queue, Buffer.from(JSON.stringify(message)), { persistent: true });
  }

  /** Reintentos acotados de un mensaje ante fallo TRANSITORIO (paridad con BullMQ). */
  private static readonly MAX_ATTEMPTS = 5;

  /**
   * Consume una cola durable en un CANAL DEDICADO (así el `prefetch` es por-consumidor,
   * sin afectar a otras colas). El handler recibe el mensaje ya parseado.
   *
   * RESILIENCIA (QA): un fallo del handler NO descarta el mensaje al instante (eso perdía
   * boletos/correos ante un fallo transitorio de SMTP/DB, a diferencia de BullMQ que
   * reintentaba). Se REENCOLA con un contador `x-attempts` hasta MAX_ATTEMPTS; agotados,
   * se registra fuerte y se descarta (evita bucle infinito). Un mensaje MALFORMADO
   * (JSON inválido) se ackea y loguea (no puede reprocesarse; no debe colgar el canal).
   */
  async consume<T>(queue: string, handler: (message: T) => Promise<void>, prefetch = 16): Promise<void> {
    const conn = await this.getConnection();
    const ch = await conn.createChannel();
    this.consumerChannels.push(ch);
    await ch.assertQueue(queue, { durable: true });
    await ch.prefetch(prefetch);
    await ch.consume(queue, (msg) => {
      if (!msg) return;
      let payload: T;
      try {
        payload = JSON.parse(msg.content.toString()) as T;
      } catch {
        this.logger.error(`Mensaje malformado en ${queue}; se descarta (no reprocesable)`);
        ch.ack(msg);
        return;
      }
      const attempts = Number(msg.properties.headers?.['x-attempts'] ?? 0);
      handler(payload)
        .then(() => ch.ack(msg))
        .catch((err) => {
          this.logger.error(
            `Fallo procesando ${queue} (intento ${attempts + 1}/${RabbitService.MAX_ATTEMPTS}): ${(err as Error).message}`,
          );
          if (attempts + 1 < RabbitService.MAX_ATTEMPTS) {
            // Reencola con el contador incrementado (canal dedicado → sin afectar orden
            // de otras colas). ack del original para no dejarlo unacked.
            ch.sendToQueue(queue, msg.content, {
              persistent: true,
              headers: { ...msg.properties.headers, 'x-attempts': attempts + 1 },
            });
            ch.ack(msg);
          } else {
            this.logger.error(`${queue}: agotados ${RabbitService.MAX_ATTEMPTS} intentos; se descarta el mensaje`);
            ch.ack(msg); // (futuro: dead-letter en vez de descartar)
          }
        });
    });
    this.logger.log(`Consumidor RabbitMQ activo en ${queue} (prefetch ${prefetch})`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.consumerChannels.map((c) => c.close().catch(() => undefined)));
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }
}
