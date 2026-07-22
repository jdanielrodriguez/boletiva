import {
  Controller,
  Headers,
  HttpCode,
  MessageEvent,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Sse,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { Observable } from 'rxjs';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { verifyAccessToken } from '../../common/auth/access-token';
import { Public } from '../../common/decorators/public.decorator';
import { SkipRateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { StreamService } from './stream.service';

/**
 * Snapshot inicial que abre el stream SSE (evento `snapshot`). Los eventos en
 * vivo posteriores (`order`/`seat`/`wallet`) llevan payloads propios de cada
 * emisor y no se modelan aquí (flujo text/event-stream).
 */
export class OrderStreamSnapshotDto {
  @ApiProperty({ format: 'uuid', description: 'Identificador de la orden' })
  id!: string;

  @ApiProperty({ enum: OrderStatus, description: 'Estado actual de la orden' })
  status!: OrderStatus;

  @ApiProperty({ type: String, example: '129.68', description: 'Total de la orden (GTQ)' })
  total!: string;
}

/** Ticket efímero de un solo uso para abrir el SSE sin poner el access token en la URL. */
export class StreamTicketDto {
  @ApiProperty({ description: 'Ticket de un solo uso (pásalo como ?ticket= al abrir el SSE)' })
  ticket!: string;

  @ApiProperty({ description: 'Segundos de validez', example: 60 })
  expiresIn!: number;
}

const TICKET_TTL_S = 60;

@ApiTags('stream')
@Controller()
export class StreamController {
  private readonly jwtSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stream: StreamService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.jwtSecret = config.getOrThrow<string>('jwt.accessSecret');
  }

  /**
   * H4: emite un TICKET de un solo uso (Redis, 60 s) acotado a esta orden y usuario, para
   * abrir el SSE sin exponer el access token (900 s) en la URL/logs de Cloud Run/LB.
   * Requiere sesión (Bearer en header, no en URL) y ser el dueño de la orden (IDOR→404).
   */
  @Post('orders/:id/stream-ticket')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Emite un ticket de un solo uso para abrir el SSE de la orden' })
  @ApiOkResponse({ type: StreamTicketDto })
  async streamTicket(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') userId: string,
  ): Promise<StreamTicketDto> {
    const order = await this.prisma.order.findUnique({ where: { id }, select: { buyerId: true } });
    if (!order || order.buyerId !== userId) throw new NotFoundException('Orden no encontrada');
    const ticket = randomBytes(24).toString('base64url');
    await this.redis.getClient().set(`sse:ticket:${ticket}`, `${id}:${userId}`, 'EX', TICKET_TTL_S);
    return { ticket, expiresIn: TICKET_TTL_S };
  }

  /**
   * Stream SSE del checkout: estado de la orden (pending→paid/…), deltas de asientos del
   * evento y `wallet` del comprador — push sin polling. Auth por `?ticket=` (preferido: de
   * un solo uso, ver stream-ticket) o, por compatibilidad, `?access_token=`/Bearer
   * (EventSource no envía headers). Solo el dueño (IDOR→404).
   */
  @Public()
  @SkipRateLimit()
  @Sse('orders/:id/stream')
  @ApiOperation({ summary: 'Stream SSE del checkout (order/seat/wallet). Auth: ?ticket= (o ?access_token=)' })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description:
      'Flujo Server-Sent Events. Abre con un evento `snapshot` (OrderStreamSnapshotDto) ' +
      'y luego empuja eventos en vivo `order`/`seat`/`wallet` sin polling.',
    type: OrderStreamSnapshotDto,
  })
  async orderStream(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('ticket') ticket?: string,
    @Query('access_token') accessToken?: string,
    @Headers('authorization') authorization?: string,
  ): Promise<Observable<MessageEvent>> {
    const userId = await this.resolveUserId(id, ticket, accessToken, authorization);
    if (!userId) throw new UnauthorizedException('Se requiere un ticket o token válido');

    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { id: true, buyerId: true, eventId: true, status: true, total: true },
    });
    if (!order || order.buyerId !== userId) {
      throw new NotFoundException('Orden no encontrada'); // IDOR → 404
    }
    const snapshot = { id: order.id, status: order.status, total: order.total.toFixed(2) };
    return this.stream.streamForOrder(
      { id: order.id, buyerId: order.buyerId, eventId: order.eventId },
      userId,
      snapshot,
    );
  }

  @Public()
  @SkipRateLimit()
  @Sse('events/:id/seats/stream')
  @ApiOperation({ summary: 'Stream SSE público de disponibilidad de asientos del evento (FU11)' })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description: 'Flujo SSE: abre con `ready` y empuja deltas `seat` ({sold|released}) del evento.',
  })
  seatsStream(@Param('id', ParseUUIDPipe) id: string): Observable<MessageEvent> {
    return this.stream.streamSeats(id);
  }

  /** Resuelve el userId desde el ticket de un solo uso o, como fallback, un JWT válido. */
  private async resolveUserId(
    orderId: string,
    ticket?: string,
    accessToken?: string,
    authorization?: string,
  ): Promise<string | null> {
    if (ticket) {
      // GETDEL: consume el ticket (un solo uso). Debe corresponder a ESTA orden.
      const raw = await this.redis.getClient().getdel(`sse:ticket:${ticket}`).catch(() => null);
      if (!raw) return null;
      const [ordId, uid] = raw.split(':');
      return ordId === orderId && uid ? uid : null;
    }
    const jwt = accessToken || (authorization?.startsWith('Bearer ') ? authorization.slice(7) : '');
    // Validación ÚNICA de access token (rechaza preauth 2FA, etc.) — helper compartido.
    return verifyAccessToken(this.jwt, this.jwtSecret, jwt || undefined)?.sub ?? null;
  }
}
