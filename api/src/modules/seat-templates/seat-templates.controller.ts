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
import { SeatTemplatesService } from './seat-templates.service';
import {
  CreateSeatTemplateDto,
  SeatTemplateResponseDto,
  UpdateSeatTemplateDto,
} from './dto/seat-templates.dto';
import { ScopeDashboardDto } from '../analytics/dto/scope-dashboard.dto';

@ApiTags('seat-templates')
@ApiBearerAuth()
@Controller('seat-templates')
export class SeatTemplatesController {
  constructor(private readonly templates: SeatTemplatesService) {}

  @Get()
  @Roles(Role.promoter, Role.admin)
  @ApiOperation({ summary: 'Plantillas de asientos (para el desplegable del editor; solo publicadas)' })
  @ApiOkResponse({ type: SeatTemplateResponseDto, isArray: true })
  list() {
    // El editor (promotor y admin) solo debe ver las plantillas publicadas y
    // visibles. La gestión completa vive en /seat-templates/all (admin).
    return this.templates.listPublished();
  }

  @Get('all')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Todas las plantillas en cualquier estado (gestión admin)' })
  @ApiOkResponse({ type: SeatTemplateResponseDto, isArray: true })
  listAll() {
    return this.templates.list();
  }

  @Get(':id')
  @Roles(Role.promoter, Role.admin)
  @ApiOperation({ summary: 'Detalle de una plantilla' })
  @ApiOkResponse({ type: SeatTemplateResponseDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.get(id);
  }

  @Get(':id/dashboard')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Dashboard de la plantilla: métricas agregadas de los eventos que la usan (admin)' })
  @ApiOkResponse({ type: ScopeDashboardDto })
  dashboard(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.dashboard(id);
  }

  @Post()
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Crea una plantilla de asientos (admin)' })
  @ApiCreatedResponse({ type: SeatTemplateResponseDto })
  create(@Body() dto: CreateSeatTemplateDto) {
    return this.templates.create(dto);
  }

  @Patch(':id')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Actualiza una plantilla (admin; built-in bloqueada)' })
  @ApiOkResponse({ type: SeatTemplateResponseDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSeatTemplateDto) {
    return this.templates.update(id, dto);
  }

  @Post(':id/publish')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Publica una plantilla (admin)' })
  @ApiOkResponse({ type: SeatTemplateResponseDto })
  publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.setStatus(id, ContentStatus.published);
  }

  @Post(':id/unpublish')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Regresa una plantilla a borrador (admin)' })
  @ApiOkResponse({ type: SeatTemplateResponseDto })
  unpublish(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.setStatus(id, ContentStatus.draft);
  }

  @Post(':id/hide')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Oculta una plantilla del desplegable del promotor (admin)' })
  @ApiOkResponse({ type: SeatTemplateResponseDto })
  hide(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.setHidden(id, true);
  }

  @Post(':id/unhide')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Muestra de nuevo una plantilla oculta (admin)' })
  @ApiOkResponse({ type: SeatTemplateResponseDto })
  unhide(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.setHidden(id, false);
  }

  @Post(':id/disable')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Deshabilita una plantilla (prerequisito para eliminar; admin)' })
  @ApiOkResponse({ type: SeatTemplateResponseDto })
  disable(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.setDisabled(id, true);
  }

  @Post(':id/enable')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Habilita una plantilla deshabilitada (admin)' })
  @ApiOkResponse({ type: SeatTemplateResponseDto })
  enable(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.setDisabled(id, false);
  }

  @Delete(':id')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Elimina una plantilla (admin; solo deshabilitada; built-in bloqueada)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.remove(id);
  }
}
