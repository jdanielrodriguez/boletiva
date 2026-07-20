import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

interface SocketUser {
  userId: string;
  roles: Role[];
}

/**
 * Gateway de chat de soporte (B3, socket.io namespace `/chat`). Autentica el
 * handshake con el JWT de acceso (en `auth.token`), agrupa por sala de hilo
 * (`thread:<id>`) para entrega en vivo y lleva PRESENCIA de agentes conectados
 * (asesores/admins) para el ruteo del fallback. El servicio emite aquí
 * (`emitMessage`/`emitThread`); los clientes se unen a su hilo con `join-thread`.
 * NOTA prod multi-instancia: enganchar `@socket.io/redis-adapter` (Redis ya está)
 * detrás de esta misma interfaz.
 */
@WebSocketGateway({ namespace: '/chat', cors: { origin: true, credentials: true } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);
  @WebSocketServer() server!: Server;
  /** userIds de agentes (asesor/admin) conectados (presencia in-memory, 1 instancia). */
  private readonly agents = new Set<string>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  handleConnection(client: Socket): void {
    const token = (client.handshake.auth?.token as string) || (client.handshake.query?.token as string);
    const user = this.verify(token);
    if (!user) {
      client.emit('unauthorized');
      client.disconnect(true);
      return;
    }
    client.data.user = user;
    client.join(`user:${user.userId}`);
    if (user.roles.includes(Role.advisor) || user.roles.includes(Role.admin)) {
      client.join('agents');
      this.agents.add(user.userId);
    }
  }

  handleDisconnect(client: Socket): void {
    const user = client.data.user as SocketUser | undefined;
    if (!user) return;
    // ¿Le quedan otros sockets abiertos? Si no, sale de presencia.
    const room = this.server.sockets.adapter.rooms.get(`user:${user.userId}`);
    if (!room || room.size === 0) this.agents.delete(user.userId);
  }

  /** El cliente pide unirse a la sala de un hilo (para recibir mensajes en vivo). */
  @SubscribeMessage('join-thread')
  onJoinThread(@ConnectedSocket() client: Socket, @MessageBody() data: { threadId?: string }): void {
    if (data?.threadId) client.join(`thread:${data.threadId}`);
  }

  @SubscribeMessage('leave-thread')
  onLeaveThread(@ConnectedSocket() client: Socket, @MessageBody() data: { threadId?: string }): void {
    if (data?.threadId) client.leave(`thread:${data.threadId}`);
  }

  /** ¿Hay al menos un agente (asesor/admin) conectado? (para el ruteo del fallback). */
  agentsOnline(): boolean {
    return this.agents.size > 0;
  }

  /** Emite un mensaje nuevo a la sala del hilo (entrega en vivo). */
  emitMessage(threadId: string, message: unknown): void {
    this.server?.to(`thread:${threadId}`).emit('message', message);
    // Aviso a los agentes (bandeja) de que hay actividad.
    this.server?.to('agents').emit('thread-activity', { threadId });
  }

  /** Emite un cambio de estado del hilo (cerrado/reasignado). */
  emitThread(threadId: string, thread: unknown): void {
    this.server?.to(`thread:${threadId}`).emit('thread', thread);
  }

  private verify(token?: string): SocketUser | null {
    if (!token) return null;
    try {
      const payload = this.jwt.verify(token, { secret: this.config.getOrThrow<string>('jwt.accessSecret') });
      return { userId: payload.sub, roles: payload.roles ?? [] };
    } catch {
      return null;
    }
  }
}
