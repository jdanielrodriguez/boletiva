import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminOnly } from '../../common/decorators/admin-only.decorator';
import { SettingsService } from './settings.service';
import { SettingViewDto, UpdateSettingDto } from './dto/settings.dto';

@ApiTags('settings')
@ApiBearerAuth()
@Roles(Role.admin)
@AdminOnly()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista todas las configuraciones del sistema con su valor actual (admin)' })
  @ApiOkResponse({ type: SettingViewDto, isArray: true })
  list() {
    return this.settings.list();
  }

  @Get(':key')
  @ApiOperation({ summary: 'Detalle de una configuración (admin)' })
  @ApiOkResponse({ type: SettingViewDto })
  get(@Param('key') key: string) {
    return this.settings.get(key);
  }

  @Patch(':key')
  @ApiOperation({ summary: 'Actualiza una configuración validando su tipo/rango (admin)' })
  @ApiOkResponse({ type: SettingViewDto })
  update(@Param('key') key: string, @Body() dto: UpdateSettingDto) {
    return this.settings.set(key, dto.value);
  }
}
