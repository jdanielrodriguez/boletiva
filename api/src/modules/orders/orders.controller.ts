import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireVerifiedEmail } from '../../common/decorators/verified-email.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { CheckoutService } from './checkout.service';
import { OrdersService } from './orders.service';
import { CheckoutDto } from './dto/orders.dto';

@ApiTags('orders')
@ApiBearerAuth()
@Controller()
export class OrdersController {
  constructor(private readonly checkout: CheckoutService, private readonly orders: OrdersService) {}

  @Post('events/:eventId/orders')
  @HttpCode(201)
  @RequireVerifiedEmail()
  @ApiOperation({ summary: 'Compra (commit): convierte los asientos reservados en una orden' })
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
  @ApiOperation({ summary: 'Lista mis órdenes' })
  listMine(@CurrentUser('userId') userId: string) {
    return this.orders.listMine(userId);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Detalle de una orden propia (o cualquiera si admin)' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.orders.findOne(id, user);
  }
}
