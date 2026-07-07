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
  private connecting?: Promise<amqp.Channel>;

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

  /** Canal AMQP (perezoso, single-flight). */
  private async getChannel(): Promise<amqp.Channel> {
    if (this.channel) return this.channel;
    if (!this.connecting) {
      this.connecting = (async () => {
        const url = this.config.getOrThrow<string>('amqp.url');
        this.connection = await amqp.connect(url);
        this.channel = await this.connection.createChannel();
        this.logger.log('Canal RabbitMQ abierto');
        return this.channel;
      })();
    }
    return this.connecting;
  }

  /** Publica un mensaje JSON en una cola durable. */
  async publish(queue: string, message: unknown): Promise<void> {
    const ch = await this.getChannel();
    await ch.assertQueue(queue, { durable: true });
    ch.sendToQueue(queue, Buffer.from(JSON.stringify(message)), { persistent: true });
  }

  /**
   * Consume una cola durable. El handler recibe el mensaje ya parseado; si resuelve
   * se hace ack, si lanza se hace nack (sin requeue infinito → a dead-letter/log).
   */
  async consume<T>(queue: string, handler: (message: T) => Promise<void>): Promise<void> {
    const ch = await this.getChannel();
    await ch.assertQueue(queue, { durable: true });
    await ch.prefetch(16);
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
    this.logger.log(`Consumidor RabbitMQ activo en ${queue}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }
}
