import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminOnly } from '../../common/decorators/admin-only.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdvisorInvitationsService } from './advisor-invitations.service';

class CreateAdvisorInvitesDto {
  @ApiProperty({ type: [String], example: ['asesor@correo.com'] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  emails!: string[];
}

class AcceptAdvisorDto {
  @ApiProperty({ description: 'Token de la invitación' })
  @IsString()
  token!: string;
}

class SetAdvisorPasswordDto {
  @ApiProperty()
  @IsString()
  token!: string;

  @ApiProperty({ minLength: 8, maxLength: 72, example: 'Password123' })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;
}

/**
 * Invitaciones de asesor (T7). El admin envía invitaciones; el destinatario confirma
 * (cuenta existente) o fija su contraseña (cuenta nueva) por token. Gating en guards.
 */
@ApiTags('advisors')
@Controller('advisors/invitations')
export class AdvisorInvitationsController {
  constructor(private readonly invites: AdvisorInvitationsService) {}

  @Post()
  @ApiBearerAuth()
  @Roles(Role.admin)
  @AdminOnly()
  @HttpCode(201)
  @ApiOperation({ summary: 'Invita asesores por correo (admin)' })
  create(@Body() dto: CreateAdvisorInvitesDto, @CurrentUser('userId') userId: string) {
    return this.invites.create(dto.emails, userId);
  }

  @Get()
  @ApiBearerAuth()
  @Roles(Role.admin)
  @AdminOnly()
  @ApiOperation({ summary: 'Lista de invitaciones de asesor (admin)' })
  list() {
    return this.invites.list();
  }

  @Get('peek')
  @Public()
  @ApiOperation({ summary: 'Valida un token de invitación (público): correo + si requiere contraseña' })
  peek(@Query('token') token: string) {
    return this.invites.peek(token);
  }

  @Post('accept')
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirma el rol asesor (usuario existente autenticado)' })
  accept(@Body() dto: AcceptAdvisorDto, @CurrentUser('userId') userId: string) {
    return this.invites.acceptExisting(dto.token, userId);
  }

  @Post('set-password')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Fija la contraseña y activa la cuenta de asesor (usuario nuevo, por token)' })
  setPassword(@Body() dto: SetAdvisorPasswordDto) {
    return this.invites.setPassword(dto.token, dto.password);
  }
}
