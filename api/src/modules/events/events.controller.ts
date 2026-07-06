import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { EventsService } from './events.service';
import { CreateEventDto, UpdateEventDto } from './dto/events.dto';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Lista eventos publicados' })
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
  listMine(@CurrentUser('userId') userId: string) {
    return this.events.listMine(userId);
  }

  @Get(':id/manage')
  @Roles(Role.promoter, Role.admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Detalle gestionable del evento (owner/admin)' })
  getManaged(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.events.getManaged(id, user);
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Evento publicado por slug (con localidades y media)' })
  getPublic(@Param('slug') slug: string) {
    return this.events.getPublicBySlug(slug);
  }

  @Post()
  @Roles(Role.promoter, Role.admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crea un evento (promotor)' })
  create(@Body() dto: CreateEventDto, @CurrentUser('userId') userId: string) {
    return this.events.create(dto, userId);
  }

  @Patch(':id')
  @Roles(Role.promoter, Role.admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualiza un evento (owner/admin)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.events.update(id, dto, user);
  }

  @Post(':id/publish')
  @Roles(Role.promoter, Role.admin)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Publica un evento' })
  publish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.events.setStatus(id, 'published', user);
  }

  @Post(':id/cancel')
  @Roles(Role.promoter, Role.admin)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancela un evento' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.events.setStatus(id, 'cancelled', user);
  }

  @Delete(':id')
  @Roles(Role.promoter, Role.admin)
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Elimina un evento (solo no publicado)' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.events.remove(id, user);
  }
}
