import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminOnly } from '../../common/decorators/admin-only.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import {
  AvatarPresignDto,
  MarkTourDto,
  SetAvatarDto,
  UpdateProfileDto,
  UpdateUserRolesDto,
  UpdateUserStatusDto,
  UserListQueryDto,
} from './dto/users.dto';
import { AvatarPresignResultDto, UserPageResponseDto, UserResponseDto } from './dto/users.response';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Patch('me')
  @ApiOperation({ summary: 'Actualiza el perfil propio' })
  @ApiOkResponse({ type: UserResponseDto })
  updateMe(@CurrentUser('userId') userId: string, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(userId, dto);
  }

  @Post('me/tours')
  @ApiOperation({ summary: 'Marca un tour de onboarding como visto (completado/saltado)' })
  @ApiOkResponse({ type: UserResponseDto })
  markTourSeen(@CurrentUser('userId') userId: string, @Body() dto: MarkTourDto) {
    return this.users.markTourSeen(userId, dto.tour);
  }

  @Post('me/avatar/presign')
  @ApiOperation({ summary: 'URL firmada para subir la foto de perfil (opcional)' })
  @ApiOkResponse({ type: AvatarPresignResultDto })
  presignAvatar(@CurrentUser('userId') userId: string, @Body() dto: AvatarPresignDto) {
    return this.users.presignAvatar(userId, dto);
  }

  @Patch('me/avatar')
  @ApiOperation({ summary: 'Confirma la foto de perfil subida (key del presign)' })
  @ApiOkResponse({ type: UserResponseDto })
  setAvatar(@CurrentUser('userId') userId: string, @Body() dto: SetAvatarDto) {
    return this.users.setAvatar(userId, dto);
  }

  @Delete('me/avatar')
  @ApiOperation({ summary: 'Quita la foto de perfil' })
  @ApiOkResponse({ type: UserResponseDto })
  clearAvatar(@CurrentUser('userId') userId: string) {
    return this.users.clearAvatar(userId);
  }

  @Get()
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Lista usuarios (admin; keyset ?cursor&limit + ?search)' })
  @ApiOkResponse({ type: UserPageResponseDto })
  list(@Query() q: UserListQueryDto) {
    return this.users.list(q);
  }

  @Get(':id')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Detalle de usuario (admin)' })
  @ApiOkResponse({ type: UserResponseDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Patch(':id/roles')
  @Roles(Role.admin)
  @AdminOnly()
  @ApiOperation({ summary: 'Asigna roles a un usuario (SOLO admin real; ni un asesor desbloqueado)' })
  @ApiOkResponse({ type: UserResponseDto })
  setRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRolesDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.users.setRoles(id, dto, actor.userId);
  }

  @Patch(':id/status')
  @Roles(Role.admin)
  @AdminOnly()
  @ApiOperation({ summary: 'Activa/desactiva un usuario (SOLO admin real)' })
  @ApiOkResponse({ type: UserResponseDto })
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.users.setStatus(id, dto, actor.userId);
  }
}
