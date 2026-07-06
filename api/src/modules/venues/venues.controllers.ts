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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  @ApiOperation({ summary: 'Agrega una localidad' })
  add(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateLocalityDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.venues.addLocality(eventId, dto, user);
  }

  @Patch('localities/:id')
  @ApiOperation({ summary: 'Actualiza una localidad' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocalityDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.venues.updateLocality(id, dto, user);
  }

  @Delete('localities/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Elimina una localidad' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.venues.removeLocality(id, user);
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
  @ApiOperation({ summary: 'Crea asientos en lote (con coordenadas opcionales)' })
  bulk(
    @Param('localityId', ParseUUIDPipe) localityId: string,
    @Body() dto: BulkSeatsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.venues.bulkCreateSeats(localityId, dto, user);
  }

  @Post('generate')
  @ApiOperation({ summary: 'Genera N asientos por cantidad (numerados)' })
  generate(
    @Param('localityId', ParseUUIDPipe) localityId: string,
    @Body() dto: GenerateSeatsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.venues.generateSeats(localityId, dto, user);
  }

  @Delete()
  @ApiOperation({ summary: 'Elimina asientos por id' })
  remove(
    @Param('localityId', ParseUUIDPipe) localityId: string,
    @Body() dto: DeleteSeatsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.venues.deleteSeats(localityId, dto, user);
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
  @ApiOperation({ summary: 'Crea una nueva versión de mapa (queda activa)' })
  create(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateSeatMapDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.venues.createSeatMap(eventId, dto, user);
  }

  @Roles(Role.promoter, Role.admin)
  @ApiBearerAuth()
  @Post('seat-maps/:id/activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activa una versión de mapa' })
  activate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.venues.setActiveSeatMap(id, user);
  }
}
