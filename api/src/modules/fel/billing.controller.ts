import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { RequireVerifiedEmail } from '../../common/decorators/verified-email.decorator';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { FelService } from './fel.service';

/** Resultado de la búsqueda de nombre por NIT (para autollenar la facturación). */
export class NitNameLookupDto {
  @ApiProperty({ description: '¿La consulta FEL está disponible? (false = escribe el nombre a mano)', example: false })
  available!: boolean;

  @ApiProperty({ description: 'Nombre fiscal encontrado (null = no encontrado o FEL off)', example: null, nullable: true })
  name!: string | null;
}

@ApiTags('billing')
@ApiBearerAuth()
@Controller('billing')
export class BillingController {
  constructor(private readonly fel: FelService) {}

  /**
   * Busca el nombre fiscal por NIT para autollenar el checkout. Config-gated por FEL:
   * si la integración está desactivada devuelve `{ available:false, name:null }` (el
   * frontend deja escribir el nombre); si está activa y lo encuentra, el frontend
   * autollena y bloquea el input. Best-effort, nunca falla el flujo.
   */
  @Get('nit-name')
  @RequireVerifiedEmail()
  @RateLimit({ limit: 20, windowSec: 60 })
  @ApiOperation({ summary: 'Nombre fiscal por NIT (autollenar facturación; config-gated por FEL)' })
  @ApiOkResponse({ type: NitNameLookupDto })
  lookup(@Query('nit') nit: string): Promise<NitNameLookupDto> {
    return this.fel.lookupReceptorName(nit ?? '');
  }
}
