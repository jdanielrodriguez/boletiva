import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { PromoterDashboardService } from './promoter-dashboard.service';
import { PromoterDashboardExportService } from './promoter-dashboard-export.service';
import { PromoterDashboardDto } from './dto/promoter-dashboard.dto';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('promoter')
export class AnalyticsController {
  constructor(
    private readonly dashboard: PromoterDashboardService,
    private readonly dashboardExport: PromoterDashboardExportService,
  ) {}

  @Get('dashboard')
  @Roles(Role.promoter, Role.admin)
  @ApiOperation({
    summary:
      'Dashboard GLOBAL del promotor: KPIs de rentabilidad + ventas/día + tabla ' +
      'cruzada por evento/categoría/salón/estado/mes. El promotor ve el suyo; el ' +
      'admin puede ver el de cualquier promotor con ?promoterId=.',
  })
  @ApiQuery({ name: 'promoterId', required: false, description: 'Solo admin: promotor a inspeccionar' })
  @ApiQuery({ name: 'eventId', required: false, description: 'Filtra el dashboard a un solo evento' })
  @ApiQuery({ name: 'status', required: false, description: 'Filtra por estado de evento (draft/published/suspended/cancelled/finished)' })
  @ApiQuery({ name: 'from', required: false, description: 'Desde (fecha del evento, ISO YYYY-MM-DD)' })
  @ApiQuery({ name: 'to', required: false, description: 'Hasta inclusive (fecha del evento, ISO YYYY-MM-DD)' })
  @ApiOkResponse({ type: PromoterDashboardDto })
  dashboardData(
    @CurrentUser() user: AuthUser,
    @Query('promoterId') promoterId?: string,
    @Query('eventId') eventId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.dashboard.forPromoter(user, promoterId, eventId, { status, from, to });
  }

  @Get('dashboard/export.xlsx')
  @Roles(Role.promoter, Role.admin)
  @RateLimit({ limit: 20, windowSec: 60 })
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOperation({
    summary:
      'Descarga el dashboard global del promotor en Excel (.xlsx): hoja de KPIs + ' +
      'una hoja por dimensión (evento/categoría/salón/estado/mes).',
  })
  @ApiQuery({ name: 'promoterId', required: false, description: 'Solo admin: promotor a inspeccionar' })
  @ApiQuery({ name: 'status', required: false, description: 'Filtra por estado de evento' })
  @ApiQuery({ name: 'from', required: false, description: 'Desde (fecha del evento, ISO YYYY-MM-DD)' })
  @ApiQuery({ name: 'to', required: false, description: 'Hasta inclusive (fecha del evento, ISO YYYY-MM-DD)' })
  @ApiOkResponse({
    description: 'Archivo .xlsx (adjunto)',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  async exportDashboard(
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query('promoterId') promoterId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<void> {
    const { filename, buffer } = await this.dashboardExport.exportForPromoter(user, promoterId, {
      status,
      from,
      to,
    });
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }
}
