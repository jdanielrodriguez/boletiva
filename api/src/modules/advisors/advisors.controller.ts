import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminOnly } from '../../common/decorators/admin-only.decorator';
import { AdvisorsService } from './advisors.service';
import { AdvisorRowDto, NotifyAdvisorDto } from './dto/advisors.dto';

/** Gestión de asesores (admin): lista + deshabilitar/habilitar/eliminar/notificar. */
@ApiTags('advisors')
@ApiBearerAuth()
@Controller('advisors')
export class AdvisorsController {
  constructor(private readonly service: AdvisorsService) {}

  @Get()
  @Roles(Role.admin)
  @AdminOnly()
  @ApiOperation({ summary: 'Lista los asesores (usuarios con rol advisor)' })
  @ApiOkResponse({ type: AdvisorRowDto, isArray: true })
  list() {
    return this.service.list();
  }

  @Post(':id/disable')
  @Roles(Role.admin)
  @AdminOnly()
  @HttpCode(200)
  @ApiOperation({ summary: 'Deshabilita a un asesor (quita el rol; queda como cliente)' })
  disable(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.disable(id);
  }

  @Post(':id/enable')
  @Roles(Role.admin)
  @AdminOnly()
  @HttpCode(200)
  @ApiOperation({ summary: 'Vuelve a habilitar a un asesor' })
  enable(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.enable(id);
  }

  @Post(':id/notify')
  @Roles(Role.admin)
  @AdminOnly()
  @HttpCode(200)
  @ApiOperation({ summary: 'Envía una notificación in-app a un asesor' })
  notify(@Param('id', ParseUUIDPipe) id: string, @Body() dto: NotifyAdvisorDto) {
    return this.service.notify(id, dto.title, dto.body);
  }

  @Delete(':id')
  @Roles(Role.admin)
  @AdminOnly()
  @HttpCode(200)
  @ApiOperation({ summary: 'Elimina (soft: inactivo) a un asesor ya deshabilitado' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
