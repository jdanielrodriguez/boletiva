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

  /**
   * Consume una cola durable en un CANAL DEDICADO (así el `prefetch` es por-consumidor:
   * p.ej. la liquidación usa prefetch=1 para procesar una a una, sin afectar a otras
   * colas). El handler recibe el mensaje ya parseado; si resuelve → ack, si lanza →
   * nack sin requeue (a dead-letter/log). `prefetch` default 16 (paralelo razonable).
   */
  async consume<T>(queue: string, handler: (message: T) => Promise<void>, prefetch = 16): Promise<void> {
    const conn = await this.getConnection();
    const ch = await conn.createChannel();
    this.consumerChannels.push(ch);
    await ch.assertQueue(queue, { durable: true });
    await ch.prefetch(prefetch);
    await ch.consume(queue, (msg) => {
      if (!msg) return;
      const payload = JSON.parse(msg.content.toString()) as T;
      handler(payload)
        .then(() => ch.ack(msg))
        .catch((err) => {
          this.logger.error(`Fallo procesando ${queue}: ${(err as Error).message}`);
          ch.nack(msg, false, false);
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
