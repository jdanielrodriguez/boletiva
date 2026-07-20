import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminOnly } from '../../common/decorators/admin-only.decorator';
import { RetentionService } from './retention.service';

class RunRetentionDto {
  @ApiPropertyOptional({
    description: 'Días de corte de retención (override del valor por env). Default: retention.days',
    minimum: 0,
    maximum: 36500,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(36500)
  days?: number;
}

/** Resultado de anonimizar (seudonimizar) a un usuario. */
class AnonymizeResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Id del usuario (se preserva, no cambia)' })
  id!: string;

  @ApiProperty({ description: 'true si quedó anonimizado (idempotente)' })
  anonymized!: boolean;
}

/** Resultado de una corrida de retención. */
class RunRetentionResponseDto {
  @ApiProperty({ description: 'Cantidad de usuarios anonimizados en esta corrida' })
  anonymized!: number;

  @ApiProperty({ description: 'Días de corte usados' })
  days!: number;
}

@ApiTags('retention')
@ApiBearerAuth()
@Roles(Role.admin)
@AdminOnly()
@Controller('admin')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Post('users/:id/anonymize')
  @HttpCode(200)
  @ApiOperation({ summary: 'Anonimiza (seudonimiza) a un usuario, preservando el ledger (admin)' })
  @ApiOkResponse({ type: AnonymizeResponseDto })
  anonymize(@Param('id', ParseUUIDPipe) id: string) {
    return this.retention.anonymizeUser(id);
  }

  @Post('retention/run')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ejecuta la retención (anonimiza a los elegibles) — admin' })
  @ApiOkResponse({ type: RunRetentionResponseDto })
  run(@Body() dto: RunRetentionDto) {
    return this.retention.runRetention(dto.days);
  }
}
