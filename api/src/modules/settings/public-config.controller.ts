import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SettingsService } from './settings.service';
import { PublicConfigDto } from './dto/settings.dto';

/**
 * Config pública leída por el frontend SIN login (render anónimo cacheable):
 * flags de UI (idioma para visitantes, categorías en el inicio). No expone
 * ningún knob financiero ni sensible; solo booleanos de presentación.
 */
@ApiTags('config')
@Controller('public/config')
export class PublicConfigController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Flags de UI públicos (sin login)' })
  @ApiOkResponse({ type: PublicConfigDto })
  get() {
    return this.settings.publicConfig();
  }
}
