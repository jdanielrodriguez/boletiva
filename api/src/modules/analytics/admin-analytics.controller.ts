import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminProfitabilityService } from './admin-profitability.service';
import { AdminProfitabilityExportService } from './admin-profitability-export.service';
import { AdminProfitabilityDto } from './dto/admin-profitability.dto';

@ApiTags('analytics')
@ApiBearerAuth()
@Roles(Role.admin)
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(
    private readonly profitability: AdminProfitabilityService,
    private readonly profitabilityExport: AdminProfitabilityExportService,
  ) {}

  @Get('profitability')
  @ApiOperation({
    summary:
      'Rentabilidad de la plataforma por evento (admin): reparto (bruto/neto/ganancia/' +
      'pasarela/IVA) + % de comisión de plataforma EFECTIVO por evento, comparables.',
  })
  @ApiOkResponse({ type: AdminProfitabilityDto })
  overview() {
    return this.profitability.overview();
  }

  @Get('profitability/export.xlsx')
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOperation({ summary: 'Descarga la rentabilidad por evento en Excel (.xlsx) (admin).' })
  @ApiOkResponse({
    description: 'Archivo .xlsx (adjunto)',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  async export(@Res() res: Response): Promise<void> {
    const { filename, buffer } = await this.profitabilityExport.export();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }
}
