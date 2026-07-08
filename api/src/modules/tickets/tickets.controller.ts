import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireVerifiedEmail } from '../../common/decorators/verified-email.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { TicketsService } from './tickets.service';
import { WalletPassService } from './wallet/wallet-pass.service';
import { TicketTransferService } from './ticket-transfer.service';
import { CreateWalletPassDto, VerifyTicketDto } from './dto/tickets.dto';
import {
  TicketCustodyResponseDto,
  TicketMediaResponseDto,
  TicketPageResponseDto,
  TicketQrResponseDto,
  TicketResponseDto,
  TransferInitiatedDto,
  VerifyTicketResultDto,
  WalletPassResponseDto,
} from './dto/tickets.response';

@ApiTags('tickets')
@ApiBearerAuth()
@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly walletPass: WalletPassService,
    private readonly transfers: TicketTransferService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Mis boletos (keyset: ?cursor&limit)' })
  @ApiOkResponse({ type: TicketPageResponseDto })
  listMine(@CurrentUser() user: AuthUser, @Query() page: PageQueryDto) {
    return this.tickets.listMine(user.userId, page);
  }

  @Post('verify')
  @Roles(Role.gate_operator, Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Valida un QR en puerta (operador) — check-in dinámico' })
  @ApiOkResponse({ type: VerifyTicketResultDto })
  verify(@Body() dto: VerifyTicketDto, @CurrentUser('userId') userId: string) {
    return this.tickets.verify(dto.payload, dto.checkIn ?? true, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un boleto (dueño/admin)' })
  @ApiOkResponse({ type: TicketResponseDto })
  getOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.tickets.getOne(id, user);
  }

  @Get(':id/qr')
  @ApiOperation({ summary: 'Valor rotativo actual del QR (dueño) — refrescar cada 30s' })
  @ApiOkResponse({ type: TicketQrResponseDto })
  qr(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.tickets.currentQr(id, user);
  }

  @Get(':id/media')
  @ApiOperation({ summary: 'URLs firmadas del QR PNG y el PDF (dueño)' })
  @ApiOkResponse({ type: TicketMediaResponseDto })
  media(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.tickets.mediaUrls(id, user);
  }

  @Get(':id/custody')
  @ApiOperation({ summary: 'Cadena de custodia del boleto (dueño/admin) + integridad' })
  @ApiOkResponse({ type: TicketCustodyResponseDto })
  custody(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.tickets.custodyChain(id, user);
  }

  @Post(':id/transfer')
  @RequireVerifiedEmail()
  @HttpCode(200)
  @ApiOperation({ summary: 'Inicia la transferencia (regalo) del boleto → devuelve el código (dueño)' })
  @ApiOkResponse({ type: TransferInitiatedDto })
  transfer(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('userId') userId: string) {
    return this.transfers.initiate(id, userId);
  }

  @Post(':id/wallet')
  @HttpCode(200)
  @ApiOperation({ summary: 'Genera un pase de wallet (Google/Apple) para el boleto (dueño)' })
  @ApiOkResponse({ type: WalletPassResponseDto })
  wallet(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateWalletPassDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.walletPass.createPass(id, dto.platform, user);
  }
}
