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
import { HallsService } from './halls.service';
import { CreateHallDto, HallResponseDto, UpdateHallDto } from './dto/halls.dto';

@ApiTags('halls')
@ApiBearerAuth()
@Controller('halls')
export class HallsController {
  constructor(private readonly halls: HallsService) {}

  @Get()
  @Roles(Role.promoter, Role.admin)
  @ApiOperation({ summary: 'Lista salones/venues (para seleccionar al crear evento)' })
  @ApiOkResponse({ type: HallResponseDto, isArray: true })
  list() {
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

  @Delete(':id')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Elimina un salón (admin; desvincula sus eventos)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.halls.remove(id);
  }
}
