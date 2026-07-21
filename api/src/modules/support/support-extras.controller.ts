import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Role, SupportCategory, SupportPriority, SupportStatus } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminOnly } from '../../common/decorators/admin-only.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { SupportService } from './support.service';
import { SupportMacrosService } from './support-macros.service';

class QueueQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: SupportStatus })
  @IsOptional()
  @IsEnum(SupportStatus)
  status?: SupportStatus;

  @ApiPropertyOptional({ enum: SupportPriority })
  @IsOptional()
  @IsEnum(SupportPriority)
  priority?: SupportPriority;

  @ApiPropertyOptional({ enum: SupportCategory })
  @IsOptional()
  @IsEnum(SupportCategory)
  category?: SupportCategory;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional({ description: "'true' = solo sin asignar" })
  @IsOptional()
  @IsString()
  unassigned?: string;

  @ApiPropertyOptional({ description: "'true' = solo los asignados a mí" })
  @IsOptional()
  @IsString()
  mine?: string;
}

class SlaConfigDto {
  @ApiProperty({
    description: 'Mapa { prioridad: { firstResponseMins, resolutionHours } }. Parcial permitido.',
    example: { urgent: { firstResponseMins: 10, resolutionHours: 2 } },
  })
  @IsObject()
  targets!: Record<string, { firstResponseMins?: number; resolutionHours?: number }>;
}

class MacroDto {
  @ApiProperty({ example: 'Saludo inicial' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title!: string;

  @ApiProperty({ example: 'Hola, gracias por escribir a soporte. Estoy revisando tu caso.' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;

  @ApiPropertyOptional({ example: 'es' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  lang?: string;

  @ApiPropertyOptional({ enum: SupportCategory })
  @IsOptional()
  @IsEnum(SupportCategory)
  category?: SupportCategory;
}

class MacroPatchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8)
  lang?: string;

  @ApiPropertyOptional({ enum: SupportCategory })
  @IsOptional()
  @IsEnum(SupportCategory)
  category?: SupportCategory;
}

/**
 * Soporte — triage y eficiencia del agente (T2): cola con filtros+paginación,
 * configuración de SLA (admin) y respuestas rápidas (macros). Todo restringido a
 * agentes/admin; el ciclo de vida del ticket vive en SupportController.
 */
@ApiTags('support')
@ApiBearerAuth()
@Controller('support')
export class SupportExtrasController {
  constructor(
    private readonly support: SupportService,
    private readonly macros: SupportMacrosService,
  ) {}

  // --- Cola del agente ---
  @Get('queue')
  @Roles(Role.admin, Role.advisor)
  @ApiOperation({ summary: 'Cola de tickets con filtros + keyset pagination (agente)' })
  queue(@CurrentUser() user: AuthUser, @Query() q: QueueQueryDto) {
    return this.support.listQueue(
      user,
      {
        status: q.status,
        priority: q.priority,
        category: q.category,
        assigneeId: q.assigneeId,
        unassigned: q.unassigned === 'true',
        mine: q.mine === 'true',
      },
      { cursor: q.cursor, limit: q.limit },
    );
  }

  // --- Agentes (para reasignar tickets) ---
  @Get('agents')
  @Roles(Role.admin, Role.advisor)
  @ApiOperation({ summary: 'Lista de agentes (asesor/admin) para reasignar tickets' })
  agents(@CurrentUser() user: AuthUser) {
    return this.support.listAgents(user);
  }

  // --- Métricas / dashboard ---
  @Get('metrics')
  @Roles(Role.admin, Role.advisor)
  @ApiOperation({ summary: 'Resumen operativo del soporte (volumen, SLA, CSAT)' })
  metrics(@CurrentUser() user: AuthUser) {
    return this.support.metrics(user);
  }

  // --- Configuración de SLA ---
  @Get('sla')
  @Roles(Role.admin, Role.advisor)
  @ApiOperation({ summary: 'Objetivos SLA efectivos por prioridad' })
  getSla() {
    return this.support.getSlaConfig();
  }

  @Patch('sla')
  @Roles(Role.admin)
  @AdminOnly()
  @ApiOperation({ summary: 'Ajusta los objetivos SLA (admin)' })
  setSla(@CurrentUser() user: AuthUser, @Body() dto: SlaConfigDto) {
    return this.support.setSlaConfig(dto.targets, user.userId);
  }

  // --- Respuestas rápidas (macros) ---
  @Get('macros')
  @Roles(Role.admin, Role.advisor)
  @ApiOperation({ summary: 'Lista de respuestas rápidas (filtrable por idioma/categoría)' })
  listMacros(@Query('lang') lang?: string, @Query('category') category?: SupportCategory) {
    return this.macros.list(lang, category);
  }

  @Post('macros')
  @Roles(Role.admin, Role.advisor)
  @HttpCode(201)
  @ApiOperation({ summary: 'Crea una respuesta rápida' })
  createMacro(@CurrentUser() user: AuthUser, @Body() dto: MacroDto) {
    return this.macros.create(dto, user.userId);
  }

  @Patch('macros/:id')
  @Roles(Role.admin, Role.advisor)
  @ApiOperation({ summary: 'Edita una respuesta rápida' })
  updateMacro(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MacroPatchDto) {
    return this.macros.update(id, dto);
  }

  @Delete('macros/:id')
  @Roles(Role.admin, Role.advisor)
  @ApiOperation({ summary: 'Elimina una respuesta rápida' })
  deleteMacro(@Param('id', ParseUUIDPipe) id: string) {
    return this.macros.remove(id);
  }
}
