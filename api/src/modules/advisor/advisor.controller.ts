import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminOnly } from '../../common/decorators/admin-only.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdvisorUnlockService } from './advisor-unlock.service';

export class ApproveAdvisorUnlockDto {
  @ApiProperty({ description: 'Token del enlace de desbloqueo recibido por el admin' })
  @IsString()
  @MinLength(10)
  token!: string;
}

export class AdvisorUnlockStatusDto {
  @ApiProperty({ description: 'true si la exigencia de desbloqueo está activa (setting)' })
  lockEnabled!: boolean;
  @ApiProperty({ description: 'true si el asesor puede mutar ya (ventana vigente o lock apagado)' })
  unlocked!: boolean;
  @ApiProperty({ format: 'date-time', nullable: true, description: 'Fin de la ventana vigente' })
  expiresAt!: Date | null;
  @ApiProperty({ description: 'true si hay una solicitud pendiente de aprobación' })
  pending!: boolean;
}

export class AdvisorUnlockStateDto {
  @ApiProperty({ description: 'ID del asesor' })
  advisorId!: string;
  @ApiProperty({ description: 'true si tiene una solicitud de desbloqueo pendiente' })
  pending!: boolean;
  @ApiProperty({ format: 'date-time', nullable: true, description: 'Momento de la solicitud pendiente' })
  requestedAt!: Date | null;
  @ApiProperty({ description: 'true si tiene una ventana de desbloqueo vigente' })
  unlocked!: boolean;
  @ApiProperty({ format: 'date-time', nullable: true, description: 'Fin de la ventana vigente' })
  expiresAt!: Date | null;
}

export class GrantAdvisorUnlockResultDto {
  @ApiProperty()
  granted!: boolean;
  @ApiProperty()
  advisorId!: string;
  @ApiProperty({ format: 'date-time', nullable: true })
  expiresAt!: Date | null;
}

/**
 * Desbloqueo del ASESOR (B2). El asesor SOLICITA (correo con enlace al admin) y
 * consulta su estado; el ADMIN aprueba desde el enlace. La ventana la aplica el
 * `AdvisorUnlockGuard` global sobre las mutaciones de área admin del asesor.
 */
@ApiTags('advisor')
@ApiBearerAuth()
@Controller('advisor/unlock')
export class AdvisorController {
  constructor(private readonly unlock: AdvisorUnlockService) {}

  @Post('request')
  @Roles(Role.advisor)
  @HttpCode(200)
  @ApiOperation({ summary: 'El asesor solicita desbloqueo → correo con enlace al admin' })
  request(@CurrentUser('userId') advisorId: string) {
    return this.unlock.request(advisorId);
  }

  @Get('status')
  @Roles(Role.advisor)
  @ApiOperation({ summary: 'Estado de desbloqueo del asesor autenticado' })
  @ApiOkResponse({ type: AdvisorUnlockStatusDto })
  status(@CurrentUser('userId') advisorId: string) {
    return this.unlock.status(advisorId);
  }

  @Post('approve')
  @Roles(Role.admin)
  @AdminOnly() // EXCLUSIVO admin: un asesor (que hereda admin) NO puede auto-aprobarse.
  @Audit('admin.advisor.unlock.approve', { resource: 'advisor-unlock' })
  @HttpCode(200)
  @ApiOperation({ summary: 'El admin aprueba el desbloqueo del asesor (desde el enlace)' })
  approve(@Body() dto: ApproveAdvisorUnlockDto, @CurrentUser('userId') adminId: string) {
    return this.unlock.approve(dto.token, adminId);
  }

  @Get('pending')
  @Roles(Role.admin)
  @AdminOnly() // EXCLUSIVO admin: un asesor NO ve/gestiona los desbloqueos.
  @ApiOperation({ summary: 'Estado de desbloqueo de todos los asesores con actividad (panel admin)' })
  @ApiOkResponse({ type: AdvisorUnlockStateDto, isArray: true })
  listPending() {
    return this.unlock.listUnlockStates();
  }

  @Post('grant/:advisorId')
  @Roles(Role.admin)
  @AdminOnly() // EXCLUSIVO admin: concede el desbloqueo directo, sin el token del correo.
  @Audit('admin.advisor.unlock.grant', { resource: 'advisor', param: 'advisorId' })
  @HttpCode(200)
  @ApiOperation({ summary: 'El admin concede el desbloqueo del asesor directamente (sin enlace)' })
  @ApiOkResponse({ type: GrantAdvisorUnlockResultDto })
  grant(@Param('advisorId') advisorId: string, @CurrentUser('userId') adminId: string) {
    return this.unlock.grant(advisorId, adminId);
  }
}
