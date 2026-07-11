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
  @Roles(Role.promoter, Role.admin)
  @ApiOperation({ summary: 'Detalle de un salón' })
  @ApiOkResponse({ type: HallResponseDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.halls.get(id);
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

  @Delete(':id')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Elimina un salón (admin; desvincula sus eventos)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.halls.remove(id);
  }
}
