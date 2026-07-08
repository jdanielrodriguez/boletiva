import { Controller, MessageEvent, NotFoundException, Param, ParseUUIDPipe, Sse } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StreamService } from './stream.service';

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
  @ApiOperation({ summary: 'Stream SSE del checkout (order/seat/wallet). Auth: ?access_token=' })
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
