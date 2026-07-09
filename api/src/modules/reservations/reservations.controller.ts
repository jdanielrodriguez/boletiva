import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
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
import { OrderResponseDto } from '../orders/dto/orders.dto';
import { ReservationsService } from './reservations.service';
import {
  CheckoutReservationDto,
  CreateReservationDto,
  ReservationResponseDto,
} from './dto/reservations.dto';

@ApiTags('reservations')
@Controller()
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Public()
  @Post('events/:eventId/reservations')
  @ApiOperation({ summary: 'Crea una reserva ANÓNIMA y compartible (sin login)' })
  @ApiCreatedResponse({ type: ReservationResponseDto })
  create(@Param('eventId', ParseUUIDPipe) eventId: string, @Body() dto: CreateReservationDto) {
    return this.reservations.create(eventId, dto);
  }

  @Public()
  @Get('reservations/:token')
  @ApiOperation({ summary: 'Ver una reserva por su token (desde el link compartido)' })
  @ApiOkResponse({ type: ReservationResponseDto })
  getByToken(@Param('token') token: string) {
    return this.reservations.getByToken(token);
  }

  @Post('reservations/:token/checkout')
  @RequireVerifiedEmail()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Paga una reserva: crea la orden a nombre del usuario logueado' })
  @ApiCreatedResponse({ type: OrderResponseDto })
  checkout(
    @Param('token') token: string,
    @Body() dto: CheckoutReservationDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.reservations.checkoutReservation(token, userId, {
      nit: dto.billingNit,
      name: dto.billingName,
      address: dto.billingAddress,
    });
  }
}
