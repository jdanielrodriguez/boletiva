import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ValidationIngestService } from './validation-ingest.service';
import { BatchCheckinDto } from './dto/tickets.dto';

@ApiTags('validation-ingest')
@ApiBearerAuth()
@Controller()
export class ValidationIngestController {
  constructor(private readonly ingest: ValidationIngestService) {}

  @Post('checkins/batch')
  @Roles(Role.gate_operator, Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Ingesta un lote de check-ins offline (bus RabbitMQ)' })
  batch(@Body() dto: BatchCheckinDto) {
    return this.ingest.submit(dto.items, dto.gateId);
  }

  @Get('events/:eventId/checkins/conflicts')
  @Roles(Role.gate_operator, Role.admin)
  @ApiOperation({ summary: 'Conflictos de validación del evento (dobles check-in)' })
  conflicts(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.ingest.listConflicts(eventId);
  }
}
