import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TicketSyncService } from './ticket-sync.service';

@ApiTags('ticket-manifest')
@ApiBearerAuth()
@Controller('events/:eventId/manifest')
export class TicketManifestController {
  constructor(private readonly sync: TicketSyncService) {}

  @Get()
  @Roles(Role.gate_operator, Role.admin)
  @ApiOperation({
    summary: 'Manifiesto firmado de validación offline del evento (delta desde ?since)',
  })
  manifest(@Param('eventId', ParseUUIDPipe) eventId: string, @Query('since') since?: string) {
    const from = since ? Math.max(0, parseInt(since, 10) || 0) : 0;
    return this.sync.manifest(eventId, from);
  }
}
