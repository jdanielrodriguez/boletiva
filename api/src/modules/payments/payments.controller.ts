import { Body, Controller, Headers, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { RequireVerifiedEmail } from '../../common/decorators/verified-email.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';
import { WebhookDto } from './dto/payments.dto';

@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('orders/:id/pay')
  @HttpCode(201)
  @ApiBearerAuth()
  @RequireVerifiedEmail()
  @ApiOperation({ summary: 'Inicia el pago de una orden (webhook-first)' })
  pay(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('userId') userId: string) {
    return this.payments.initiate(id, userId);
  }

  @Post('payments/webhook')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook de la pasarela (firma HMAC; idempotente)' })
  webhook(@Body() dto: WebhookDto, @Headers('x-webhook-signature') signature?: string) {
    return this.payments.handleWebhook(dto, signature);
  }
}
