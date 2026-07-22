import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminOnly } from '../../common/decorators/admin-only.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { NotificationsService } from './notifications.service';
import type { NotificationChannel } from './notification.types';

class SetPreferenceDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  type!: string;

  @ApiProperty({ enum: ['inapp', 'email'] })
  @IsIn(['inapp', 'email'])
  channel!: NotificationChannel;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

class AdminSendDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Promotor destino (si no es "a todos")' })
  @ValidateIf((o) => !o.all)
  @IsUUID()
  promoterId?: string;

  @ApiPropertyOptional({ description: 'true = a todos los promotores' })
  @IsOptional()
  @IsBoolean()
  all?: boolean;

  @ApiProperty({ example: 'Mantenimiento programado' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title!: string;

  @ApiProperty({ example: 'El sábado habrá mantenimiento de 2 a 4 am.' })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}

/**
 * Notificaciones in-app (T5). Cada usuario lee/gestiona LAS SUYAS; el admin puede
 * ENVIAR notificaciones manuales a un promotor o a todos (tab de admin en el frontend).
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Mis notificaciones (keyset)' })
  list(@CurrentUser() user: AuthUser, @Query() page: PageQueryDto) {
    return this.notifications.list(user.userId, { cursor: page.cursor, limit: page.limit });
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Contador de no-leídas' })
  async unread(@CurrentUser() user: AuthUser) {
    return { count: await this.notifications.unreadCount(user.userId) };
  }

  @Post('read/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marca una notificación como leída' })
  read(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.notifications.markRead(user.userId, id);
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marca todas como leídas' })
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.userId);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Mis preferencias de notificación' })
  prefs(@CurrentUser() user: AuthUser) {
    return this.notifications.getPreferences(user.userId);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Activa/desactiva un tipo por canal' })
  setPref(@CurrentUser() user: AuthUser, @Body() dto: SetPreferenceDto) {
    return this.notifications.setPreference(user.userId, dto.type, dto.channel, dto.enabled);
  }

  @Post('admin/send')
  @Roles(Role.admin)
  @AdminOnly()
  @HttpCode(201)
  @ApiOperation({ summary: 'Envía una notificación manual a un promotor o a todos (admin)' })
  adminSend(@CurrentUser() user: AuthUser, @Body() dto: AdminSendDto) {
    return this.notifications.adminSend(user.userId, dto);
  }
}
