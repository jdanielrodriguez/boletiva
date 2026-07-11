import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireVerifiedEmail } from '../../common/decorators/verified-email.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { EventsService } from './events.service';
import { CreateEventDto, UpdateEventDto } from './dto/events.dto';
import {
  EventAvailabilityDto,
  EventResponseDto,
  ManagedEventDetailDto,
  AdminEventListItemDto,
  MyEventListItemDto,
  PublicEventDetailDto,
  PublicEventListDto,
  PublicEventListItemDto,
} from './dto/events.response';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Lista eventos publicados' })
  @ApiOkResponse({ type: PublicEventListDto })
  listPublic(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('category') categorySlug?: string,
    @Query('search') search?: string,
  ) {
    return this.events.listPublic({
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
      categorySlug,
      search,
    });
  }

  @Get('mine')
  @Roles(Role.promoter, Role.admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eventos del promotor autenticado' })
  @ApiOkResponse({ type: MyEventListItemDto, isArray: true })
  listMine(@CurrentUser('userId') userId: string) {
    return this.events.listMine(userId);
  }

  @Get('all')
  @Roles(Role.admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Todos los eventos con su promotor (admin)' })
  @ApiOkResponse({ type: AdminEventListItemDto, isArray: true })
  listAll() {
    return this.events.listAll();
  }

  @Get(':id/manage')
  @Roles(Role.promoter, Role.admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Detalle gestionable del evento (owner/admin)' })
  @ApiOkResponse({ type: ManagedEventDetailDto })
  getManaged(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.events.getManaged(id, user);
  }

  @Public()
  @Get('promoted')
  @ApiOperation({ summary: 'Eventos destacados para el slider del inicio (ordenados por prioridad)' })
  @ApiOkResponse({ type: PublicEventListItemDto, isArray: true })
  listPromoted() {
    return this.events.listPromoted();
  }

  @Public()
  @Get(':eventId/availability')
  @ApiOperation({
    summary: 'Disponibilidad para comprar: mapa + localidades (con precio) + asientos',
  })
  @ApiOkResponse({ type: EventAvailabilityDto })
  getAvailability(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.events.getAvailability(eventId);
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Evento publicado por slug (con localidades y media)' })
  @ApiOkResponse({ type: PublicEventDetailDto })
  getPublic(@Param('slug') slug: string) {
    return this.events.getPublicBySlug(slug);
  }

  @Post()
  @Roles(Role.promoter, Role.admin)
  @RequireVerifiedEmail()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crea un evento (promotor, requiere correo verificado)' })
  @ApiCreatedResponse({ type: EventResponseDto })
  create(@Body() dto: CreateEventDto, @CurrentUser('userId') userId: string) {
    return this.events.create(dto, userId);
  }

  @Patch(':id')
  @Roles(Role.promoter, Role.admin)
  @ApiBearerAuth()
  @ApiHeader({ name: 'x-edit-unlock', required: false, description: 'Token de desbloqueo (admin no-dueño)' })
  @ApiOperation({ summary: 'Actualiza un evento (owner/admin; admin no-dueño requiere desbloqueo)' })
  @ApiOkResponse({ type: EventResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventDto,
    @CurrentUser() user: AuthUser,
    @Headers('x-edit-unlock') unlockToken?: string,
  ) {
    return this.events.update(id, dto, user, unlockToken);
  }

  @Post(':id/publish')
  @Roles(Role.promoter, Role.admin)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiHeader({ name: 'x-edit-unlock', required: false, description: 'Token de desbloqueo (admin no-dueño)' })
  @ApiOperation({ summary: 'Publica un evento' })
  @ApiOkResponse({ type: EventResponseDto })
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-edit-unlock') unlockToken?: string,
  ) {
    return this.events.setStatus(id, 'published', user, unlockToken);
  }

  @Post(':id/suspend')
  @Roles(Role.promoter, Role.admin)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiHeader({ name: 'x-edit-unlock', required: false, description: 'Token de desbloqueo (admin no-dueño)' })
  @ApiOperation({
    summary: 'Suspende un evento publicado (lo despublica y lo pone en reconfiguración; re-publicable)',
  })
  @ApiOkResponse({ type: EventResponseDto })
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-edit-unlock') unlockToken?: string,
  ) {
    return this.events.suspend(id, user, unlockToken);
  }

  @Post(':id/cancel')
  @Roles(Role.promoter, Role.admin)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiHeader({ name: 'x-edit-unlock', required: false, description: 'Token de desbloqueo (admin no-dueño)' })
  @ApiOperation({ summary: 'Cancela un evento (terminal)' })
  @ApiOkResponse({ type: EventResponseDto })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-edit-unlock') unlockToken?: string,
  ) {
    return this.events.setStatus(id, 'cancelled', user, unlockToken);
  }

  @Delete(':id')
  @Roles(Role.promoter, Role.admin)
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiHeader({ name: 'x-edit-unlock', required: false, description: 'Token de desbloqueo (admin no-dueño)' })
  @ApiOperation({ summary: 'Elimina un evento (solo no publicado)' })
  @ApiNoContentResponse({ description: 'Evento eliminado' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-edit-unlock') unlockToken?: string,
  ) {
    return this.events.remove(id, user, unlockToken);
  }
}
