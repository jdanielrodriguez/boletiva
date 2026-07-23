import { Body, Controller, Get, Patch, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminOnly } from '../../common/decorators/admin-only.decorator';
import { AllowDuringMaintenance } from '../../common/decorators/maintenance.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { MaintenanceService } from './maintenance.service';
import { MaintenanceStatusDto, UpdateMaintenanceDto } from './dto/maintenance.dto';

@ApiTags('maintenance')
@AdminOnly()
@UseInterceptors(AuditInterceptor)
@Controller()
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get('maintenance')
  @Public()
  @AllowDuringMaintenance()
  @ApiOperation({ summary: 'Estado del modo mantenimiento (público)' })
  @ApiOkResponse({ type: MaintenanceStatusDto })
  status(): Promise<MaintenanceStatusDto> {
    return this.maintenance.getStatus();
  }

  @Patch('admin/maintenance')
  @Roles(Role.admin)
  @Audit('admin.maintenance.set', { resource: 'maintenance' })
  @ApiBearerAuth()
  @AllowDuringMaintenance()
  @ApiOperation({ summary: 'Activa/desactiva el modo mantenimiento (admin)' })
  @ApiOkResponse({ type: MaintenanceStatusDto })
  update(@Body() dto: UpdateMaintenanceDto): Promise<MaintenanceStatusDto> {
    return this.maintenance.set(dto.enabled, dto.message);
  }
}
