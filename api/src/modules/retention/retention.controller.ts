import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RetentionService } from './retention.service';

class RunRetentionDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(36500)
  days?: number;
}

@ApiTags('retention')
@ApiBearerAuth()
@Roles(Role.admin)
@Controller('admin')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Post('users/:id/anonymize')
  @HttpCode(200)
  @ApiOperation({ summary: 'Anonimiza (seudonimiza) a un usuario, preservando el ledger (admin)' })
  anonymize(@Param('id', ParseUUIDPipe) id: string) {
    return this.retention.anonymizeUser(id);
  }

  @Post('retention/run')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ejecuta la retención (anonimiza a los elegibles) — admin' })
  run(@Body() dto: RunRetentionDto) {
    return this.retention.runRetention(dto.days);
  }
}
