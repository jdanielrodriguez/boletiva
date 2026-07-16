import { Controller, MessageEvent, NotFoundException, Param, ParseUUIDPipe, Sse } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiProperty, ApiTags } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';
import { Observable } from 'rxjs';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
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

@ApiTags('stream')
@Controller()
export class StreamController {
  constructor(private readonly prisma: PrismaService, private readonly stream: StreamService) {}

  /**
   * Server-Sent Events del checkout: estado de la orden (pending→paid/…), deltas de
   * asientos del evento y `wallet` del comprador — push sin polling. Auth por
   * `?access_token=` (EventSource no envía headers); solo el dueño (IDOR→404).
   */
  @Sse('orders/:id/stream')
  @SkipRateLimit()
  @ApiOperation({ summary: 'Stream SSE del checkout (order/seat/wallet). Auth: ?access_token=' })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description:
      'Flujo Server-Sent Events. Abre con un evento `snapshot` (OrderStreamSnapshotDto) ' +
      'y luego empuja eventos en vivo `order`/`seat`/`wallet` sin polling.',
    type: OrderStreamSnapshotDto,
  })
  async orderStream(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') userId: string,
  ): Promise<Observable<MessageEvent>> {
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
}
