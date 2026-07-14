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
  @ApiOkResponse({ type: PromoterDashboardDto })
  dashboardData(
    @CurrentUser() user: AuthUser,
    @Query('promoterId') promoterId?: string,
  ) {
    return this.dashboard.forPromoter(user, promoterId);
  }

  @Get('dashboard/export.xlsx')
  @Roles(Role.promoter, Role.admin)
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOperation({
    summary:
      'Descarga el dashboard global del promotor en Excel (.xlsx): hoja de KPIs + ' +
      'una hoja por dimensión (evento/categoría/salón/estado/mes).',
  })
  @ApiQuery({ name: 'promoterId', required: false, description: 'Solo admin: promotor a inspeccionar' })
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
  ): Promise<void> {
    const { filename, buffer } = await this.dashboardExport.exportForPromoter(user, promoterId);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }
}
