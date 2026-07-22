import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireVerifiedEmail } from '../../common/decorators/verified-email.decorator';
import { NoAdminPurchaseGuard } from '../../common/guards/no-admin-purchase.guard';
import { PaymentMethodsService } from './payment-methods.service';
import { AddPaymentMethodDto, PaymentMethodResponseDto } from './dto/payment-methods.dto';

/**
 * Métodos de pago del usuario (tarjetas tokenizadas). PCI-DSS: el cuerpo del alta
 * lleva un nonce del SDK de la pasarela, jamás el PAN.
 */
@ApiTags('payment-methods')
@ApiBearerAuth()
@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly service: PaymentMethodsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista mis métodos de pago (sin datos sensibles)' })
  @ApiOkResponse({ type: PaymentMethodResponseDto, isArray: true })
  list(@CurrentUser('userId') userId: string) {
    return this.service.list(userId);
  }

  @Post()
  @RequireVerifiedEmail()
  @UseGuards(NoAdminPurchaseGuard) // el admin no registra tarjetas (no compra como cliente)
  @ApiOperation({ summary: 'Guarda una tarjeta (tokeniza el nonce; nunca recibe el PAN)' })
  @ApiOkResponse({ type: PaymentMethodResponseDto })
  add(@CurrentUser('userId') userId: string, @Body() dto: AddPaymentMethodDto) {
    return this.service.add(userId, dto);
  }

  @Post(':id/default')
  @ApiOperation({ summary: 'Marca un método propio como predeterminado' })
  @ApiOkResponse({ type: PaymentMethodResponseDto })
  setDefault(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.setDefault(userId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Elimina un método de pago propio' })
  remove(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(userId, id);
  }
}
