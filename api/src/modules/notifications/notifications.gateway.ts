import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Server, Socket } from 'socket.io';
import { RedisService } from '../../infra/redis/redis.service';

/**
 * Gateway de notificaciones in-app (T5, namespace `/notifications`). Autentica el
 * handshake con el JWT de acceso y mete cada socket en la sala `user:<id>`. El
 * servicio empuja `notification` (nueva) y `unread` (contador) a esa sala. Igual que
 * el de soporte: Redis adapter gated para fan-out multi-instancia.
 */
@WebSocketGateway({ namespace: '/notifications', cors: { origin: true, credentials: true } })
export class NotificationsGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(NotificationsGateway.name);
  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  afterInit(server: Server): void {
    if (!this.config.get<boolean>('support.socketRedis')) return;
    try {
      const pub = this.redis.getClient().duplicate();
      const sub = this.redis.getClient().duplicate();
      server.adapter(createAdapter(pub, sub));
      this.logger.log('socket.io Redis adapter activo (notificaciones)');
    } catch (e) {
      this.logger.warn(`No se pudo activar el Redis adapter de notificaciones: ${(e as Error).message}`);
    }
  }

  handleConnection(client: Socket): void {
    const token = (client.handshake.auth?.token as string) || (client.handshake.query?.token as string);
    const userId = this.verify(token);
    if (!userId) {
      client.emit('unauthorized');
      client.disconnect(true);
      return;
    }
    client.join(`user:${userId}`);
  }

  /** Empuja una notificación nueva a su destinatario. */
  emitNotification(userId: string, notification: unknown): void {
    this.server?.to(`user:${userId}`).emit('notification', notification);
  }

  /** Empuja el contador de no-leídos actualizado. */
  emitUnread(userId: string, count: number): void {
    this.server?.to(`user:${userId}`).emit('unread', { count });
  }

  private verify(token?: string): string | null {
    if (!token) return null;
    try {
      const payload = this.jwt.verify(token, { secret: this.config.getOrThrow<string>('jwt.accessSecret') });
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }
}
