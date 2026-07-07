import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, WithdrawalStatus } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireVerifiedEmail } from '../../common/decorators/verified-email.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WalletService } from './wallet.service';
import { WalletWithdrawalService } from './wallet-withdrawal.service';
import { RequestWithdrawalDto, WithdrawalDecisionDto } from './dto/wallet.dto';

@ApiTags('wallet')
@ApiBearerAuth()
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly withdrawals: WalletWithdrawalService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Saldo interno del usuario' })
  me(@CurrentUser('userId') userId: string) {
    return this.wallet.summary(userId);
  }

  @Post('withdrawals')
  @RequireVerifiedEmail()
  @HttpCode(201)
  @ApiOperation({ summary: 'Solicita un retiro de saldo (reserva en el ledger)' })
  request(@Body() dto: RequestWithdrawalDto, @CurrentUser('userId') userId: string) {
    return this.withdrawals.request(userId, dto.amount);
  }

  @Get('withdrawals')
  @ApiOperation({ summary: 'Mis retiros' })
  mine(@CurrentUser('userId') userId: string) {
    return this.withdrawals.listMine(userId);
  }

  @Get('withdrawals/all')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Todos los retiros (admin), filtrable por estado' })
  all(@Query('status') status?: string) {
    if (status && !(status in WithdrawalStatus)) {
      throw new BadRequestException('Estado de retiro inválido');
    }
    return this.withdrawals.listAll(status as WithdrawalStatus | undefined);
  }

  @Post('withdrawals/:id/approve')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Aprueba un retiro (admin)' })
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('userId') adminId: string) {
    return this.withdrawals.approve(id, adminId);
  }

  @Post('withdrawals/:id/pay')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Marca un retiro como pagado (admin)' })
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WithdrawalDecisionDto,
    @CurrentUser('userId') adminId: string,
  ) {
    return this.withdrawals.pay(id, adminId, dto.note);
  }

  @Post('withdrawals/:id/reject')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Rechaza un retiro y reintegra el saldo (admin)' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WithdrawalDecisionDto,
    @CurrentUser('userId') adminId: string,
  ) {
    return this.withdrawals.reject(id, adminId, dto.note);
  }

  @Delete('withdrawals/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancela un retiro propio pendiente (reintegra el saldo)' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('userId') userId: string) {
    return this.withdrawals.cancel(id, userId);
  }
}
