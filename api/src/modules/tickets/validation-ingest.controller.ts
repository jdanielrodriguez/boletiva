import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ValidationIngestService } from './validation-ingest.service';
import { GateAccessService } from './gate-access.service';
import { BatchCheckinDto } from './dto/tickets.dto';
import { BatchCheckinResultDto, CheckinConflictDto } from './dto/tickets.response';

@ApiTags('validation-ingest')
@ApiBearerAuth()
@Controller()
export class ValidationIngestController {
  constructor(
    private readonly ingest: ValidationIngestService,
    private readonly gateAccess: GateAccessService,
  ) {}

  @Post('events/:eventId/checkins/batch')
  @Roles(Role.gate_operator, Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Ingesta un lote de check-ins offline del evento (operador asignado)' })
  @ApiOkResponse({ type: BatchCheckinResultDto })
  async batch(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: BatchCheckinDto,
    @CurrentUser() user: AuthUser,
  ) {
    // 8.1: solo un operador ASIGNADO al evento (o admin) puede ingerir check-ins de él.
    await this.gateAccess.assertAssignedToEvent(eventId, user);
    return this.ingest.submit(dto.items, eventId, dto.gateId);
  }

  @Get('events/:eventId/checkins/conflicts')
  @Roles(Role.gate_operator, Role.admin)
  @ApiOperation({ summary: 'Conflictos de validación del evento (dobles check-in)' })
  @ApiOkResponse({ type: CheckinConflictDto, isArray: true })
  conflicts(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.ingest.listConflicts(eventId);
  }
}
