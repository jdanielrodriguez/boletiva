import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Server, Socket } from 'socket.io';
import { RedisService } from '../../infra/redis/redis.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { verifyAccessToken } from '../../common/auth/access-token';

interface SocketUser {
  userId: string;
  roles: Role[];
}

/**
 * Gateway de soporte (T1, socket.io namespace `/support`; evoluciona el de chat B3).
 * Autentica el handshake con el JWT de acceso (`auth.token`), agrupa por sala de
 * ticket (`ticket:<id>`) para entrega en vivo y lleva PRESENCIA de agentes (asesor/
 * admin) para el ruteo. El servicio emite aquí (`emitMessage`/`emitTicket`).
 *
 * CONCURRENCIA multi-instancia: en `afterInit` engancha `@socket.io/redis-adapter`
 * (pub/sub sobre el ioredis existente) cuando `support.socketRedis` está activo, para
 * que los eventos lleguen a los clientes conectados a CUALQUIER instancia (Cloud Run).
 * Apagado por defecto y en test (in-memory, 1 instancia).
 */
@WebSocketGateway({ namespace: '/support', cors: { origin: true, credentials: true } })
export class SupportGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(SupportGateway.name);
  @WebSocketServer() server!: Server;
  /** userIds de agentes conectados (presencia in-memory; con Redis adapter, por-instancia). */
  private readonly agents = new Set<string>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: Server): void {
    if (!this.config.get<boolean>('support.socketRedis')) return;
    try {
      const pub = this.redis.getClient().duplicate();
      const sub = this.redis.getClient().duplicate();
      server.adapter(createAdapter(pub, sub));
      this.logger.log('socket.io Redis adapter activo (fan-out multi-instancia)');
    } catch (e) {
      this.logger.warn(`No se pudo activar el Redis adapter de sockets: ${(e as Error).message}`);
    }
  }

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
    const room = this.server.sockets.adapter.rooms.get(`user:${user.userId}`);
    if (!room || room.size === 0) this.agents.delete(user.userId);
  }

  /**
   * El cliente pide unirse a la sala de un ticket (para recibir mensajes en vivo).
   * AUTORIZA el join (H-1): solo un agente (asesor/admin) o el PROMOTOR DUEÑO del ticket
   * pueden entrar → un usuario autenticado que conozca/acierte el UUID de un ticket ajeno
   * ya no recibe sus mensajes. Sin permiso → `join-denied` y no se une.
   */
  @SubscribeMessage('join-ticket')
  async onJoinTicket(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId?: string },
  ): Promise<void> {
    const user = client.data.user as SocketUser | undefined;
    if (!user || !data?.ticketId) return;
    const isAgent = user.roles.includes(Role.advisor) || user.roles.includes(Role.admin);
    if (!isAgent) {
      const ticket = await this.prisma.supportTicket.findUnique({
        where: { id: data.ticketId },
        select: { promoterId: true },
      });
      if (!ticket || ticket.promoterId !== user.userId) {
        client.emit('join-denied', { ticketId: data.ticketId });
        return;
      }
    }
    client.join(`ticket:${data.ticketId}`);
  }

  @SubscribeMessage('leave-ticket')
  onLeaveTicket(@ConnectedSocket() client: Socket, @MessageBody() data: { ticketId?: string }): void {
    if (data?.ticketId) client.leave(`ticket:${data.ticketId}`);
  }

  /** ¿Hay al menos un agente conectado a ESTA instancia? (heurística de presencia). */
  agentsOnline(): boolean {
    return this.agents.size > 0;
  }

  /** Emite un mensaje nuevo a la sala del ticket + avisa a los agentes (bandeja). */
  emitMessage(ticketId: string, message: unknown): void {
    this.server?.to(`ticket:${ticketId}`).emit('message', message);
    this.server?.to('agents').emit('ticket-activity', { ticketId });
  }

  /**
   * Emite una NOTA INTERNA solo a los agentes (nunca a la sala del ticket, donde el
   * promotor dueño está unido). Evita la fuga en vivo de notas internas al promotor.
   */
  emitInternalNote(ticketId: string, message: unknown): void {
    this.server?.to('agents').emit('message', message);
    this.server?.to('agents').emit('ticket-activity', { ticketId });
  }

  /** Emite un cambio de estado/asignación del ticket. */
  emitTicket(ticketId: string, ticket: unknown): void {
    this.server?.to(`ticket:${ticketId}`).emit('ticket', ticket);
    this.server?.to('agents').emit('ticket-activity', { ticketId });
  }

  private verify(token?: string): SocketUser | null {
    // Validación ÚNICA de access token (rechaza preauth 2FA, etc.) — helper compartido.
    const claims = verifyAccessToken(this.jwt, this.config.getOrThrow<string>('jwt.accessSecret'), token);
    return claims ? { userId: claims.sub, roles: claims.roles } : null;
  }
}
