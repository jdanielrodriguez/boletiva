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
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ContentStatus, Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { HallsService } from './halls.service';
import { CreateHallDto, HallResponseDto, UpdateHallDto } from './dto/halls.dto';
import { ScopeDashboardDto } from '../analytics/dto/scope-dashboard.dto';

@ApiTags('halls')
@ApiBearerAuth()
@Controller('halls')
export class HallsController {
  constructor(private readonly halls: HallsService) {}

  @Get()
  @Roles(Role.promoter, Role.admin)
  @ApiOperation({ summary: 'Salones publicados (para seleccionar al crear evento)' })
  @ApiOkResponse({ type: HallResponseDto, isArray: true })
  list() {
    return this.halls.listPublished();
  }

  @Get('all')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Todos los salones en cualquier estado (gestión admin)' })
  @ApiOkResponse({ type: HallResponseDto, isArray: true })
  listAll() {
    return this.halls.list();
  }

  @Get(':id')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Detalle de un salón (gestión admin; incluye estado y notas internas)' })
  @ApiOkResponse({ type: HallResponseDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    // Admin-only: devuelve CUALQUIER estado (draft/hidden) + `notes` internas. El
    // promotor elige salones publicados desde el listado `GET /halls` (listPublished),
    // no debe leer un salón en borrador ni sus notas por id (QA fuga de visibilidad).
    return this.halls.get(id);
  }

  @Get(':id/dashboard')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Dashboard del salón: métricas agregadas de todos sus eventos (admin)' })
  @ApiOkResponse({ type: ScopeDashboardDto })
  dashboard(@Param('id', ParseUUIDPipe) id: string) {
    return this.halls.dashboard(id);
  }

  @Post()
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Crea un salón (admin)' })
  @ApiCreatedResponse({ type: HallResponseDto })
  create(@Body() dto: CreateHallDto) {
    return this.halls.create(dto);
  }

  @Patch(':id')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Actualiza un salón (admin)' })
  @ApiOkResponse({ type: HallResponseDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateHallDto) {
    return this.halls.update(id, dto);
  }

  @Post(':id/publish')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Publica un salón (admin; visible para promotores)' })
  @ApiOkResponse({ type: HallResponseDto })
  publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.halls.setStatus(id, ContentStatus.published);
  }

  @Post(':id/unpublish')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Regresa un salón a borrador (admin)' })
  @ApiOkResponse({ type: HallResponseDto })
  unpublish(@Param('id', ParseUUIDPipe) id: string) {
    return this.halls.setStatus(id, ContentStatus.draft);
  }

  @Post(':id/hide')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Oculta un salón del selector del promotor (admin)' })
  @ApiOkResponse({ type: HallResponseDto })
  hide(@Param('id', ParseUUIDPipe) id: string) {
    return this.halls.setHidden(id, true);
  }

  @Post(':id/unhide')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Muestra de nuevo un salón oculto (admin)' })
  @ApiOkResponse({ type: HallResponseDto })
  unhide(@Param('id', ParseUUIDPipe) id: string) {
    return this.halls.setHidden(id, false);
  }

  @Post(':id/disable')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Deshabilita un salón (prerequisito para eliminar; admin)' })
  @ApiOkResponse({ type: HallResponseDto })
  disable(@Param('id', ParseUUIDPipe) id: string) {
    return this.halls.setDisabled(id, true);
  }

  @Post(':id/enable')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Habilita un salón deshabilitado (admin)' })
  @ApiOkResponse({ type: HallResponseDto })
  enable(@Param('id', ParseUUIDPipe) id: string) {
    return this.halls.setDisabled(id, false);
  }

  @Delete(':id')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Elimina un salón (admin; solo deshabilitado; desvincula sus eventos)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.halls.remove(id);
  }
}
