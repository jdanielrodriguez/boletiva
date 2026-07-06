import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'net';

/**
 * RabbitMQ — bus para la validación masiva (fan-in de escaneos en puerta).
 * En la Ola 0 solo verificamos conectividad (TCP). La publicación/consumo real
 * (amqplib) se agrega en la ola de validación.
 */
@Injectable()
export class RabbitService {
  private readonly logger = new Logger(RabbitService.name);

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
}
