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
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { VenuesService } from './venues.service';
import {
  BulkSeatsDto,
  CreateLocalityDto,
  CreateSeatMapDto,
  DeleteSeatsDto,
  GenerateSeatsDto,
  UpdateLocalityDto,
} from './dto/venues.dto';

@ApiTags('localities')
@ApiBearerAuth()
@Roles(Role.promoter, Role.admin)
@Controller()
export class LocalitiesController {
  constructor(private readonly venues: VenuesService) {}

  @Get('events/:eventId/localities')
  @ApiOperation({ summary: 'Localidades del evento (gestión)' })
  list(@Param('eventId', ParseUUIDPipe) eventId: string, @CurrentUser() user: AuthUser) {
    return this.venues.listLocalities(eventId, user);
  }

  @Post('events/:eventId/localities')
  @ApiHeader({ name: 'x-edit-unlock', required: false })
  @ApiOperation({ summary: 'Agrega una localidad' })
  add(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateLocalityDto,
    @CurrentUser() user: AuthUser,
    @Headers('x-edit-unlock') unlockToken?: string,
  ) {
    return this.venues.addLocality(eventId, dto, user, unlockToken);
  }

  @Patch('localities/:id')
  @ApiHeader({ name: 'x-edit-unlock', required: false })
  @ApiOperation({ summary: 'Actualiza una localidad' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocalityDto,
    @CurrentUser() user: AuthUser,
    @Headers('x-edit-unlock') unlockToken?: string,
  ) {
    return this.venues.updateLocality(id, dto, user, unlockToken);
  }

  @Delete('localities/:id')
  @HttpCode(204)
  @ApiHeader({ name: 'x-edit-unlock', required: false })
  @ApiOperation({ summary: 'Elimina una localidad' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-edit-unlock') unlockToken?: string,
  ) {
    return this.venues.removeLocality(id, user, unlockToken);
  }
}

@ApiTags('seats')
@ApiBearerAuth()
@Roles(Role.promoter, Role.admin)
@Controller('localities/:localityId/seats')
export class SeatsController {
  constructor(private readonly venues: VenuesService) {}

  @Get()
  @ApiOperation({ summary: 'Asientos de la localidad' })
  list(@Param('localityId', ParseUUIDPipe) localityId: string, @CurrentUser() user: AuthUser) {
    return this.venues.listSeats(localityId, user);
  }

  @Post()
  @ApiHeader({ name: 'x-edit-unlock', required: false })
  @ApiOperation({ summary: 'Crea asientos en lote (con coordenadas opcionales)' })
  bulk(
    @Param('localityId', ParseUUIDPipe) localityId: string,
    @Body() dto: BulkSeatsDto,
    @CurrentUser() user: AuthUser,
    @Headers('x-edit-unlock') unlockToken?: string,
  ) {
    return this.venues.bulkCreateSeats(localityId, dto, user, unlockToken);
  }

  @Put()
  @ApiHeader({ name: 'x-edit-unlock', required: false })
  @ApiOperation({
    summary:
      'Reemplaza (migra) el mapa de asientos por un layout nuevo, conservando los vendidos',
  })
  replace(
    @Param('localityId', ParseUUIDPipe) localityId: string,
    @Body() dto: BulkSeatsDto,
    @CurrentUser() user: AuthUser,
    @Headers('x-edit-unlock') unlockToken?: string,
  ) {
    return this.venues.replaceSeats(localityId, dto, user, unlockToken);
  }

  @Post('generate')
  @ApiHeader({ name: 'x-edit-unlock', required: false })
  @ApiOperation({ summary: 'Genera N asientos por cantidad (numerados)' })
  generate(
    @Param('localityId', ParseUUIDPipe) localityId: string,
    @Body() dto: GenerateSeatsDto,
    @CurrentUser() user: AuthUser,
    @Headers('x-edit-unlock') unlockToken?: string,
  ) {
    return this.venues.generateSeats(localityId, dto, user, unlockToken);
  }

  @Delete()
  @ApiHeader({ name: 'x-edit-unlock', required: false })
  @ApiOperation({ summary: 'Elimina asientos por id' })
  remove(
    @Param('localityId', ParseUUIDPipe) localityId: string,
    @Body() dto: DeleteSeatsDto,
    @CurrentUser() user: AuthUser,
    @Headers('x-edit-unlock') unlockToken?: string,
  ) {
    return this.venues.deleteSeats(localityId, dto, user, unlockToken);
  }
}

@ApiTags('seat-maps')
@Controller()
export class SeatMapsController {
  constructor(private readonly venues: VenuesService) {}

  @Public()
  @Get('events/:eventId/seat-map')
  @ApiOperation({ summary: 'Mapa de asientos activo del evento (público)' })
  getActive(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.venues.getActiveSeatMap(eventId);
  }

  @Roles(Role.promoter, Role.admin)
  @ApiBearerAuth()
  @Get('events/:eventId/seat-maps')
  @ApiOperation({ summary: 'Versiones de mapa del evento (gestión)' })
  list(@Param('eventId', ParseUUIDPipe) eventId: string, @CurrentUser() user: AuthUser) {
    return this.venues.listSeatMaps(eventId, user);
  }

  @Roles(Role.promoter, Role.admin)
  @ApiBearerAuth()
  @Post('events/:eventId/seat-maps')
  @ApiHeader({ name: 'x-edit-unlock', required: false })
  @ApiOperation({ summary: 'Crea una nueva versión de mapa (queda activa)' })
  create(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateSeatMapDto,
    @CurrentUser() user: AuthUser,
    @Headers('x-edit-unlock') unlockToken?: string,
  ) {
    return this.venues.createSeatMap(eventId, dto, user, unlockToken);
  }

  @Roles(Role.promoter, Role.admin)
  @ApiBearerAuth()
  @Post('seat-maps/:id/activate')
  @HttpCode(200)
  @ApiHeader({ name: 'x-edit-unlock', required: false })
  @ApiOperation({ summary: 'Activa una versión de mapa' })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-edit-unlock') unlockToken?: string,
  ) {
    return this.venues.setActiveSeatMap(id, user, unlockToken);
  }
}
