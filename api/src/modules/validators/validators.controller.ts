import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SkipRateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ValidatorsService } from './validators.service';
import {
  CheckinStatsDto,
  ClaimResponseDto,
  ClaimValidatorDto,
  InviteValidatorDto,
  ValidatorDisabledDto,
  ValidatorInviteResponseDto,
  ValidatorListItemDto,
  ValidatorPeekDto,
  ValidatorStreamTicketDto,
} from './dto/validators.dto';

/** Gestión de validadores de un evento (admin/promotor dueño). */
@ApiTags('validators')
@ApiBearerAuth()
@Controller('events/:eventId/validators')
export class EventValidatorsController {
  constructor(private readonly validators: ValidatorsService) {}

  @Get()
  @Roles(Role.admin, Role.promoter)
  @ApiOperation({ summary: 'Lista los validadores del evento y su estado' })
  @ApiOkResponse({ type: ValidatorListItemDto, isArray: true })
  list(@Param('eventId', ParseUUIDPipe) eventId: string, @CurrentUser() user: AuthUser) {
    return this.validators.list(eventId, user);
  }

  @Get('checkin-stats')
  @Roles(Role.admin, Role.promoter)
  @ApiOperation({ summary: 'Dashboard de check-ins del evento (avance, por localidad/validador, conflictos)' })
  @ApiOkResponse({ type: CheckinStatsDto })
  checkinStats(@Param('eventId', ParseUUIDPipe) eventId: string, @CurrentUser() user: AuthUser) {
    return this.validators.checkinStats(eventId, user);
  }

  @Post('stream-ticket')
  @HttpCode(200)
  @Roles(Role.admin, Role.promoter)
  @ApiOperation({ summary: 'Emite un ticket de un solo uso para abrir el SSE del dashboard' })
  @ApiOkResponse({ type: ValidatorStreamTicketDto })
  streamTicket(@Param('eventId', ParseUUIDPipe) eventId: string, @CurrentUser() user: AuthUser) {
    return this.validators.issueStreamTicket(eventId, user);
  }

  @Public()
  @SkipRateLimit()
  @Sse('checkin-stream')
  @ApiOperation({
    summary: 'Stream SSE del dashboard de check-ins (empuja un evento por validación). Auth: ?ticket=',
  })
  @ApiProduces('text/event-stream')
  checkinStream(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query('ticket') ticket?: string,
  ): Promise<Observable<MessageEvent>> {
    // EventSource no envía headers → se abre con un TICKET de un solo uso (?ticket=), emitido
    // por POST stream-ticket con Bearer + ownership. Sin JWT en la URL (CWE-317).
    return this.validators.checkinStreamByTicket(eventId, ticket);
  }

  @Post()
  @HttpCode(201)
  @Roles(Role.admin, Role.promoter)
  @ApiOperation({ summary: 'Invita/habilita un validador por email (envía código + magic-link)' })
  @ApiCreatedResponse({ type: ValidatorInviteResponseDto })
  invite(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: InviteValidatorDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.validators.invite(eventId, dto.email, user);
  }

  @Delete()
  @HttpCode(200)
  @Roles(Role.admin, Role.promoter)
  @ApiOperation({ summary: 'Deshabilita TODOS los validadores del evento a la vez' })
  @ApiOkResponse({ type: ValidatorDisabledDto })
  disableAll(@Param('eventId', ParseUUIDPipe) eventId: string, @CurrentUser() user: AuthUser) {
    return this.validators.disableAll(eventId, user);
  }

  @Delete(':id')
  @HttpCode(200)
  @Roles(Role.admin, Role.promoter)
  @ApiOperation({ summary: 'Deshabilita un validador (revoca su acceso al instante)' })
  @ApiOkResponse({ type: ValidatorDisabledDto })
  disable(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.validators.disable(eventId, id, user);
  }

  @Post(':id/enable')
  @HttpCode(200)
  @Roles(Role.admin, Role.promoter)
  @ApiOperation({ summary: 'Re-habilita un validador y le reenvía un nuevo acceso' })
  @ApiOkResponse({ type: ValidatorInviteResponseDto })
  enable(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.validators.enable(eventId, id, user);
  }
}

/** Canje público del magic-link (sin sesión) → abre el validador. */
@ApiTags('validators')
@Controller('validators')
export class ValidatorClaimController {
  constructor(private readonly validators: ValidatorsService) {}

  @Public()
  @Get(':token')
  @ApiOperation({ summary: 'Previsualiza el acceso de validación (evento + email)' })
  @ApiOkResponse({ type: ValidatorPeekDto })
  peek(@Param('token') token: string) {
    return this.validators.peek(token);
  }

  @Public()
  @Post('claim')
  @HttpCode(200)
  @ApiOperation({ summary: 'Canjea el magic-link por un token de puerta para validar' })
  @ApiOkResponse({ type: ClaimResponseDto })
  claim(@Body() dto: ClaimValidatorDto) {
    return this.validators.claim(dto.token);
  }
}
