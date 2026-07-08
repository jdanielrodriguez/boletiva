import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { TicketSyncService } from './ticket-sync.service';
import { GateAccessService } from './gate-access.service';
import { ManifestResponseDto } from './dto/tickets.response';

@ApiTags('ticket-manifest')
@ApiBearerAuth()
@Controller('events/:eventId/manifest')
export class TicketManifestController {
  constructor(
    private readonly sync: TicketSyncService,
    private readonly gate: GateAccessService,
  ) {}

  @Get()
  @Roles(Role.gate_operator, Role.admin)
  @ApiOperation({
    summary:
      'Manifiesto firmado de validación offline (delta desde ?since). Requiere token de PUERTA del evento; expira (SafeTix).',
  })
  @ApiOkResponse({ type: ManifestResponseDto })
  async manifest(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser() user: AuthUser,
    @Query('since') since?: string,
  ) {
    // Endurecimiento SafeTix: token de puerta del evento + asignación viva (admin exento).
    await this.gate.assertManifestAccess(eventId, user);
    const from = since ? Math.max(0, parseInt(since, 10) || 0) : 0;
    return this.sync.manifest(eventId, from);
  }
}
