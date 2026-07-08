import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireVerifiedEmail } from '../../common/decorators/verified-email.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TicketTransferService } from './ticket-transfer.service';
import { ClaimTransferDto } from './dto/tickets.dto';
import {
  OutgoingTransferDto,
  TransferCancelledDto,
  TransferClaimedDto,
} from './dto/tickets.response';

@ApiTags('ticket-transfers')
@ApiBearerAuth()
@Controller('tickets/transfers')
export class TicketTransfersController {
  constructor(private readonly transfers: TicketTransferService) {}

  @Post('claim')
  @RequireVerifiedEmail()
  @HttpCode(200)
  @ApiOperation({ summary: 'Canjea un código de transferencia (destinatario verificado)' })
  @ApiOkResponse({ type: TransferClaimedDto })
  claim(@Body() dto: ClaimTransferDto, @CurrentUser('userId') userId: string) {
    return this.transfers.claim(dto.code, userId);
  }

  @Get('outgoing')
  @ApiOperation({ summary: 'Mis transferencias pendientes (como remitente)' })
  @ApiOkResponse({ type: OutgoingTransferDto, isArray: true })
  outgoing(@CurrentUser('userId') userId: string) {
    return this.transfers.outgoing(userId);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancela una transferencia pendiente (remitente)' })
  @ApiOkResponse({ type: TransferCancelledDto })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('userId') userId: string) {
    return this.transfers.cancel(id, userId);
  }
}
