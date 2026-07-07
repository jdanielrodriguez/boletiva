import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { TicketsService } from './tickets.service';
import { WalletPassService } from './wallet/wallet-pass.service';
import { CreateWalletPassDto, VerifyTicketDto } from './dto/tickets.dto';

@ApiTags('tickets')
@ApiBearerAuth()
@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly walletPass: WalletPassService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Mis boletos' })
  listMine(@CurrentUser() user: AuthUser) {
    return this.tickets.listMine(user.userId);
  }

  @Post('verify')
  @Roles(Role.gate_operator, Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Valida un QR en puerta (operador) — check-in dinámico' })
  verify(@Body() dto: VerifyTicketDto, @CurrentUser('userId') userId: string) {
    return this.tickets.verify(dto.payload, dto.checkIn ?? true, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un boleto (dueño/admin)' })
  getOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.tickets.getOne(id, user);
  }

  @Get(':id/qr')
  @ApiOperation({ summary: 'Valor rotativo actual del QR (dueño) — refrescar cada 30s' })
  qr(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.tickets.currentQr(id, user);
  }

  @Get(':id/media')
  @ApiOperation({ summary: 'URLs firmadas del QR PNG y el PDF (dueño)' })
  media(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.tickets.mediaUrls(id, user);
  }

  @Get(':id/custody')
  @ApiOperation({ summary: 'Cadena de custodia del boleto (dueño/admin) + integridad' })
  custody(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.tickets.custodyChain(id, user);
  }

  @Post(':id/wallet')
  @HttpCode(200)
  @ApiOperation({ summary: 'Genera un pase de wallet (Google/Apple) para el boleto (dueño)' })
  wallet(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateWalletPassDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.walletPass.createPass(id, dto.platform, user);
  }
}
