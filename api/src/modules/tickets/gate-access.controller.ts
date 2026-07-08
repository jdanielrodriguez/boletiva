import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsUUID } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { GateAccessService } from './gate-access.service';

class AssignOperatorDto {
  @ApiProperty({ description: 'ID del usuario (rol gate_operator) a asignar al evento' })
  @IsUUID()
  operatorId!: string;
}

@ApiTags('gate-access')
@ApiBearerAuth()
@Controller('events/:eventId')
export class GateAccessController {
  constructor(private readonly gate: GateAccessService) {}

  @Get('gate-operators')
  @Roles(Role.admin, Role.promoter)
  @ApiOperation({ summary: 'Operadores de puerta asignados al evento (admin/promotor dueño)' })
  list(@Param('eventId', ParseUUIDPipe) eventId: string, @CurrentUser() user: AuthUser) {
    return this.gate.list(eventId, user);
  }

  @Post('gate-operators')
  @HttpCode(201)
  @Roles(Role.admin, Role.promoter)
  @ApiOperation({ summary: 'Asigna un operador de puerta al evento (admin/promotor dueño)' })
  assign(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: AssignOperatorDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.gate.assign(eventId, dto.operatorId, user);
  }

  @Delete('gate-operators/:operatorId')
  @HttpCode(200)
  @Roles(Role.admin, Role.promoter)
  @ApiOperation({ summary: 'Revoca la asignación de un operador (corta su acceso al instante)' })
  revoke(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('operatorId', ParseUUIDPipe) operatorId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.gate.revoke(eventId, operatorId, user);
  }

  @Post('gate-token')
  @HttpCode(201)
  @Roles(Role.gate_operator, Role.admin)
  @ApiOperation({ summary: 'Emite un token de PUERTA corto/fresco acotado al evento (SafeTix)' })
  gateToken(@Param('eventId', ParseUUIDPipe) eventId: string, @CurrentUser() user: AuthUser) {
    return this.gate.issueGateToken(eventId, user);
  }
}
