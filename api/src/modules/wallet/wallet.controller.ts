import {
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
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireVerifiedEmail } from '../../common/decorators/verified-email.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { WalletService } from './wallet.service';
import { WalletWithdrawalService } from './wallet-withdrawal.service';
import {
  RequestWithdrawalDto,
  WalletBalanceResponseDto,
  WithdrawalActionResponseDto,
  WithdrawalDecisionDto,
  WithdrawalPageResponseDto,
  WithdrawalsQueryDto,
} from './dto/wallet.dto';

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
  @ApiOkResponse({ type: WalletBalanceResponseDto })
  me(@CurrentUser('userId') userId: string) {
    return this.wallet.summary(userId);
  }

  @Post('withdrawals')
  @Roles(Role.promoter, Role.admin)
  @RequireVerifiedEmail()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Solicita un retiro de saldo (reserva en el ledger). Solo promotor/admin.',
  })
  @ApiCreatedResponse({ type: WithdrawalActionResponseDto })
  request(@Body() dto: RequestWithdrawalDto, @CurrentUser('userId') userId: string) {
    return this.withdrawals.request(userId, dto.amount);
  }

  @Get('withdrawals')
  @Roles(Role.promoter, Role.admin)
  @ApiOperation({ summary: 'Mis retiros (keyset: ?cursor&limit). Solo promotor/admin.' })
  @ApiOkResponse({ type: WithdrawalPageResponseDto })
  mine(@CurrentUser('userId') userId: string, @Query() page: PageQueryDto) {
    return this.withdrawals.listMine(userId, page);
  }

  @Get('withdrawals/all')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Todos los retiros (admin), ?status y keyset ?cursor&limit' })
  @ApiOkResponse({ type: WithdrawalPageResponseDto })
  all(@Query() q: WithdrawalsQueryDto) {
    return this.withdrawals.listAll(q.status, q);
  }

  @Post('withdrawals/:id/approve')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Aprueba un retiro (admin)' })
  @ApiOkResponse({ type: WithdrawalActionResponseDto })
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('userId') adminId: string) {
    return this.withdrawals.approve(id, adminId);
  }

  @Post('withdrawals/:id/pay')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Marca un retiro como pagado (admin)' })
  @ApiOkResponse({ type: WithdrawalActionResponseDto })
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
  @ApiOkResponse({ type: WithdrawalActionResponseDto })
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
  @ApiOkResponse({ type: WithdrawalActionResponseDto })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('userId') userId: string) {
    return this.withdrawals.cancel(id, userId);
  }
}
