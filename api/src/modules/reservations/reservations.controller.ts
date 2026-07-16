import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { RequireVerifiedEmail } from '../../common/decorators/verified-email.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { clientIp } from '../../common/utils/client-ip';
import { OrderResponseDto } from '../orders/dto/orders.dto';
import { ReservationContext, ReservationsService } from './reservations.service';
import {
  CheckoutReservationDto,
  CreateReservationDto,
  ReservationResponseDto,
} from './dto/reservations.dto';

@ApiTags('reservations')
@Controller()
export class ReservationsController {
  private readonly jwtSecret: string;

  constructor(
    private readonly reservations: ReservationsService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.jwtSecret = config.getOrThrow<string>('jwt.accessSecret');
  }

  /**
   * Contexto anti-abuso: IP REAL del cliente (`req.ip` según `trust proxy`, no
   * spoofeable vía XFF) + si la petición trae un access token VÁLIDO (usuario
   * accountable → sin límite por IP). La ruta es @Public, así que el guard no puebla
   * req.user; verificamos el Bearer aquí de forma best-effort.
   */
  private ctxFrom(req: Request): ReservationContext {
    const ip = clientIp(req);

    let isUser = false;
    let userId: string | null = null;
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      try {
        const payload = this.jwt.verify<{ sub?: string }>(auth.slice(7), { secret: this.jwtSecret });
        isUser = true;
        userId = payload?.sub ?? null;
      } catch {
        isUser = false; // token inválido/expirado = visitante para el límite
      }
    }
    return { ip, isUser, userId };
  }

  @Public()
  @Post('events/:eventId/reservations')
  @ApiOperation({ summary: 'Crea una reserva ANÓNIMA y compartible (sin login)' })
  @ApiCreatedResponse({ type: ReservationResponseDto })
  create(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateReservationDto,
    @Req() req: Request,
  ) {
    return this.reservations.create(eventId, dto, this.ctxFrom(req));
  }

  @Public()
  @Get('reservations/:token')
  @ApiOperation({ summary: 'Ver una reserva por su token (desde el link compartido)' })
  @ApiOkResponse({ type: ReservationResponseDto })
  getByToken(@Param('token') token: string) {
    return this.reservations.getByToken(token);
  }

  @Public()
  @Delete('reservations/:token')
  @ApiOperation({ summary: 'Cancela una reserva anónima (libera los cupos e inicia cooldown)' })
  @ApiOkResponse({ schema: { properties: { cancelled: { type: 'boolean' } } } })
  cancel(@Param('token') token: string, @Req() req: Request) {
    return this.reservations.cancel(token, this.ctxFrom(req));
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
