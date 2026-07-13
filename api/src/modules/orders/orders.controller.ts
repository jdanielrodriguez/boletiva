import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { RequireVerifiedEmail } from '../../common/decorators/verified-email.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { CheckoutService } from './checkout.service';
import { OrdersService } from './orders.service';
import { SettlementService } from './settlement.service';
import { SettlementExportService } from './settlement-export.service';
import { EventRefundsService } from './event-refunds.service';
import {
  CheckoutDto,
  EventCashTransferDto,
  EventRefundDto,
  EventRefundResultDto,
  EventSettlementDto,
  EventTransactionPageDto,
  MovementsResponseDto,
  OrderLedgerChainDto,
  OrderPageResponseDto,
  OrderResponseDto,
} from './dto/orders.dto';

@ApiTags('orders')
@ApiBearerAuth()
@Controller()
export class OrdersController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly orders: OrdersService,
    private readonly settlement: SettlementService,
    private readonly settlementExport: SettlementExportService,
    private readonly eventRefunds: EventRefundsService,
  ) {}

  @Get('events/:eventId/settlement')
  @Roles(Role.promoter, Role.admin)
  @ApiOperation({ summary: 'Liquidación del evento: cuentas por pasarela/plataforma/promotor (owner/admin)' })
  @ApiOkResponse({ type: EventSettlementDto })
  eventSettlement(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.settlement.forEvent(eventId, user);
  }

  @Get('events/:eventId/settlement/export.xlsx')
  @Roles(Role.promoter, Role.admin)
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOperation({
    summary:
      'Descarga el detalle de la liquidación del evento en Excel (.xlsx): boletos ' +
      'vendidos + desglose (neto/plataforma/pasarela/IVA) + totales (owner/admin).',
  })
  @ApiOkResponse({
    description: 'Archivo .xlsx (adjunto)',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  async exportSettlement(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, buffer } = await this.settlementExport.exportForEvent(eventId, user);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  @Post('events/:eventId/settlement/finalize')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Finaliza el evento y transfiere el saldo de caja (neto) al wallet del promotor ' +
      '(SOLO admin; idempotente). Disponible si el evento está finalizado/suspendido o ya pasó.',
  })
  @ApiOkResponse({ type: EventCashTransferDto })
  finalizeSettlement(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.settlement.finalizeAndTransfer(eventId, user, ip, userAgent);
  }

  @Post('events/:eventId/refunds')
  @Roles(Role.promoter)
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Tramita devoluciones por cancelación/suspensión del evento (SOLO el PROMOTOR DUEÑO; ' +
      'un admin real está excluido, un admin impersonando al dueño sí puede). Acredita ' +
      'SOLO el NETO del boleto a la wallet del comprador (la cuota de servicio no se ' +
      'devuelve). Con body.orderId devuelve una orden; sin él, todas las pagadas. Idempotente.',
  })
  @ApiOkResponse({ type: EventRefundResultDto })
  refundEvent(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: EventRefundDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.eventRefunds.refund(eventId, user, { orderId: dto.orderId }, ip, userAgent);
  }

  @Get('events/:eventId/transactions')
  @Roles(Role.promoter, Role.admin)
  @ApiOperation({
    summary: 'Transacciones (órdenes) del evento para el panel (owner/admin; keyset: ?cursor&limit)',
  })
  @ApiOkResponse({ type: EventTransactionPageDto })
  eventTransactions(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: AuthUser,
    @Query() page: PageQueryDto,
  ) {
    return this.orders.listForEvent(eventId, user, page);
  }

  @Post('events/:eventId/orders')
  @HttpCode(201)
  @RequireVerifiedEmail()
  @ApiOperation({ summary: 'Compra (commit): convierte los asientos reservados en una orden' })
  @ApiCreatedResponse({ type: OrderResponseDto })
  create(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CheckoutDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.checkout.commit(eventId, dto.seatIds, userId, {
      nit: dto.billingNit,
      name: dto.billingName,
      address: dto.billingAddress,
    });
  }

  @Get('orders')
  @ApiOperation({ summary: 'Lista mis órdenes (keyset: ?cursor&limit)' })
  @ApiOkResponse({ type: OrderPageResponseDto })
  listMine(@CurrentUser('userId') userId: string, @Query() page: PageQueryDto) {
    return this.orders.listMine(userId, page);
  }

  @Get('orders/movements')
  @ApiOperation({
    summary: 'Feed de facturación: movimientos ingreso/egreso del usuario (compras + créditos)',
  })
  @ApiOkResponse({ type: MovementsResponseDto })
  movements(@CurrentUser('userId') userId: string) {
    return this.orders.listMovements(userId);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Detalle de una orden propia (o cualquiera si admin)' })
  @ApiOkResponse({ type: OrderResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.orders.findOne(id, user);
  }

  @Get('orders/:id/ledger')
  @ApiOperation({ summary: 'Cadena contable (hash-chain) de la orden — vista blockchain del comprador' })
  @ApiOkResponse({ type: OrderLedgerChainDto })
  ledgerChain(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.orders.ledgerChain(id, user);
  }
}
