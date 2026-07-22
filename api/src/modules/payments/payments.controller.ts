import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { RequireVerifiedEmail } from '../../common/decorators/verified-email.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipRateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { AllowDuringMaintenance } from '../../common/decorators/maintenance.decorator';
import { NoAdminPurchaseGuard } from '../../common/guards/no-admin-purchase.guard';
import { PaymentsService } from './payments.service';
import {
  PaymentOptionsResponseDto,
  PayOrderDto,
  PayOrderResponseDto,
  WebhookDto,
  WebhookResponseDto,
} from './dto/payments.dto';

@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('orders/:id/payment-options')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Opciones de pago del checkout: pasarelas + plazos de cuotas disponibles',
  })
  @ApiOkResponse({ type: PaymentOptionsResponseDto })
  paymentOptions(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('userId') userId: string) {
    return this.payments.paymentOptions(id, userId);
  }

  @Post('orders/:id/pay')
  @HttpCode(201)
  @ApiBearerAuth()
  @RequireVerifiedEmail()
  @UseGuards(NoAdminPurchaseGuard) // el admin no paga como comprador real
  @ApiOperation({ summary: 'Inicia el pago de una orden (webhook-first; wallet/mixto)' })
  @ApiCreatedResponse({ type: PayOrderResponseDto })
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: PayOrderDto,
  ) {
    return this.payments.initiate(id, userId, {
      gatewayId: dto.gatewayId,
      useWallet: dto.useWallet,
      installments: dto.installments,
      billingNit: dto.billingNit,
      billingName: dto.billingName,
      card: dto.card,
    });
  }

  @Post('payments/webhook')
  @Public()
  @SkipRateLimit()
  @AllowDuringMaintenance()
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook de la pasarela (firma HMAC; idempotente)' })
  @ApiOkResponse({ type: WebhookResponseDto })
  webhook(@Body() dto: WebhookDto, @Headers('x-webhook-signature') signature?: string) {
    return this.payments.handleWebhook(dto, signature);
  }

  @Post('payments/recurrente/webhook')
  @Public()
  @SkipRateLimit()
  @AllowDuringMaintenance()
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook de Recurrente (firma SVIX sobre el cuerpo CRUDO)' })
  @ApiOkResponse({ type: WebhookResponseDto })
  recurrenteWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('svix-id') svixId?: string,
    @Headers('svix-timestamp') svixTimestamp?: string,
    @Headers('svix-signature') svixSignature?: string,
  ) {
    // Svix firma el cuerpo CRUDO → usamos req.rawBody (habilitado en main.ts), no el DTO parseado.
    const rawBody = req.rawBody?.toString('utf8') ?? '';
    return this.payments.handleRecurrenteWebhook({ svixId, svixTimestamp, svixSignature }, rawBody);
  }
}
