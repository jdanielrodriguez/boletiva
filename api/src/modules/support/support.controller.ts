import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Role, SupportCategory, SupportContextType, SupportPriority } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminOnly } from '../../common/decorators/admin-only.decorator';
import { RequireVerifiedEmail } from '../../common/decorators/verified-email.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { SupportService } from './support.service';

export class CreateTicketDto {
  @ApiProperty({ example: 'Duda con la liquidación de mi evento' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  subject!: string;

  @ApiProperty({ example: 'Hola, no me cuadra el neto liquidado.' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;

  @ApiProperty({ enum: SupportCategory, required: false })
  @IsOptional()
  @IsEnum(SupportCategory)
  category?: SupportCategory;

  @ApiProperty({ enum: SupportPriority, required: false })
  @IsOptional()
  @IsEnum(SupportPriority)
  priority?: SupportPriority;

  @ApiProperty({ enum: SupportContextType, required: false })
  @IsOptional()
  @IsEnum(SupportContextType)
  contextType?: SupportContextType;

  @ApiProperty({ format: 'uuid', required: false })
  @IsOptional()
  @IsUUID()
  contextId?: string;
}

export class AttachmentDto {
  @ApiProperty({ description: 'Key devuelta por el presign' })
  @IsString()
  @MaxLength(300)
  key!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(160)
  filename!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  mime!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  size!: number;
}

export class PostMessageDto {
  @ApiProperty({ example: 'Gracias, ya lo revisé.' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;

  @ApiProperty({ required: false, description: 'Nota interna del agente (no visible al promotor)' })
  @IsOptional()
  @IsBoolean()
  internalNote?: boolean;

  @ApiProperty({ required: false, type: [AttachmentDto], description: 'Adjuntos ya subidos vía presign' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];
}

export class PresignAttachmentDto {
  @ApiProperty({ example: 'captura.png' })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  filename!: string;

  @ApiProperty({ example: 'image/png' })
  @IsString()
  @MaxLength(120)
  mime!: string;
}

export class AssignTicketDto {
  @ApiProperty({ format: 'uuid', description: 'Asesor/admin al que se reasigna' })
  @IsUUID()
  assignedToId!: string;
}

export class SetPriorityDto {
  @ApiProperty({ enum: SupportPriority })
  @IsEnum(SupportPriority)
  priority!: SupportPriority;
}

export class SetCategoryDto {
  @ApiProperty({ enum: SupportCategory })
  @IsEnum(SupportCategory)
  category!: SupportCategory;
}

export class RateTicketDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  score!: number;
}

/**
 * Tickets de soporte (T1). El promotor abre tickets y escribe; asesor/admin atienden.
 * El chat en vivo va por socket.io (SupportGateway); estos endpoints cubren el ciclo
 * de vida (estados, SLA, asignación, archivar, CSAT). Gating (chat.enabled + premium)
 * en el servicio.
 */
@ApiTags('support')
@ApiBearerAuth()
@Controller('support/tickets')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @RequireVerifiedEmail()
  @HttpCode(201)
  @ApiOperation({ summary: 'Abre un ticket de soporte (promotor premium)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto) {
    return this.support.createTicket(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lista de tickets (promotor: los suyos; agente: todos)' })
  list(@CurrentUser() user: AuthUser, @Query('archived') archived?: string) {
    return this.support.listTickets(user, archived === 'true');
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Historial de mensajes de un ticket' })
  messages(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.support.getMessages(id, user);
  }

  @Post(':id/messages')
  @RequireVerifiedEmail()
  @HttpCode(201)
  @ApiOperation({ summary: 'Publica un mensaje (o nota interna del agente), con adjuntos opcionales' })
  post(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Body() dto: PostMessageDto) {
    return this.support.postMessage(id, user, dto.body, dto.internalNote ?? false, dto.attachments ?? []);
  }

  @Post(':id/attachments/presign')
  @RequireVerifiedEmail()
  @HttpCode(200)
  @ApiOperation({ summary: 'URL firmada para subir un adjunto (el cliente hace PUT directo)' })
  presign(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Body() dto: PresignAttachmentDto) {
    return this.support.presignAttachment(id, user, dto.filename, dto.mime);
  }

  @Post(':id/take')
  @Roles(Role.admin, Role.advisor)
  @HttpCode(200)
  @ApiOperation({ summary: 'El agente toma el ticket (auto-asignación)' })
  take(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.support.take(id, user);
  }

  @Post(':id/assign')
  @Roles(Role.admin)
  @AdminOnly()
  @HttpCode(200)
  @ApiOperation({ summary: 'Reasigna a un asesor/admin (handoff, admin)' })
  assign(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Body() dto: AssignTicketDto) {
    return this.support.assign(id, dto.assignedToId, user.userId);
  }

  @Post(':id/resolve')
  @Roles(Role.admin, Role.advisor)
  @HttpCode(200)
  @ApiOperation({ summary: 'Marca el ticket como resuelto (agente)' })
  resolve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.support.resolve(id, user);
  }

  @Post(':id/close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cierra el ticket (agente o promotor dueño)' })
  close(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.support.close(id, user);
  }

  @Post(':id/reopen')
  @Roles(Role.admin, Role.advisor)
  @HttpCode(200)
  @ApiOperation({ summary: 'Reabre un ticket resuelto/cerrado (agente)' })
  reopen(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.support.reopen(id, user);
  }

  @Post(':id/suspend')
  @Roles(Role.admin, Role.advisor)
  @HttpCode(200)
  @ApiOperation({ summary: 'Suspende el ticket (congela SLA, agente)' })
  suspend(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.support.suspend(id, user);
  }

  @Post(':id/resume')
  @Roles(Role.admin, Role.advisor)
  @HttpCode(200)
  @ApiOperation({ summary: 'Reanuda un ticket suspendido (agente)' })
  resume(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.support.resumeTicket(id, user);
  }

  @Post(':id/priority')
  @Roles(Role.admin, Role.advisor)
  @HttpCode(200)
  @ApiOperation({ summary: 'Cambia la prioridad (recalcula SLA, agente)' })
  priority(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Body() dto: SetPriorityDto) {
    return this.support.setPriority(id, dto.priority, user);
  }

  @Post(':id/category')
  @Roles(Role.admin, Role.advisor)
  @HttpCode(200)
  @ApiOperation({ summary: 'Cambia la categoría (agente)' })
  category(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Body() dto: SetCategoryDto) {
    return this.support.setCategory(id, dto.category, user);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @ApiOperation({ summary: 'Archiva el ticket (oculta la vista del promotor dueño)' })
  archive(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.support.archive(id, user);
  }

  @Post(':id/rate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Califica la atención 1..5 (promotor dueño)' })
  rate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Body() dto: RateTicketDto) {
    return this.support.rate(id, user, dto.score);
  }
}
