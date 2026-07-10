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
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { SeatTemplatesService } from './seat-templates.service';
import {
  CreateSeatTemplateDto,
  SeatTemplateResponseDto,
  UpdateSeatTemplateDto,
} from './dto/seat-templates.dto';

@ApiTags('seat-templates')
@ApiBearerAuth()
@Controller('seat-templates')
export class SeatTemplatesController {
  constructor(private readonly templates: SeatTemplatesService) {}

  @Get()
  @Roles(Role.promoter, Role.admin)
  @ApiOperation({ summary: 'Plantillas de asientos (para el desplegable del editor)' })
  @ApiOkResponse({ type: SeatTemplateResponseDto, isArray: true })
  list() {
    return this.templates.list();
  }

  @Get(':id')
  @Roles(Role.promoter, Role.admin)
  @ApiOperation({ summary: 'Detalle de una plantilla' })
  @ApiOkResponse({ type: SeatTemplateResponseDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.get(id);
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

  @Delete(':id')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Elimina una plantilla (admin; built-in bloqueada)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.remove(id);
  }
}
