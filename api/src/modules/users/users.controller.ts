import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { UpdateProfileDto, UpdateUserRolesDto, UpdateUserStatusDto } from './dto/users.dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Patch('me')
  @ApiOperation({ summary: 'Actualiza el perfil propio' })
  updateMe(@CurrentUser('userId') userId: string, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(userId, dto);
  }

  @Get()
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Lista usuarios (admin)' })
  list(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('search') search?: string,
  ) {
    return this.users.list({
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
      search,
    });
  }

  @Get(':id')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Detalle de usuario (admin)' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Patch(':id/roles')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Asigna roles a un usuario (admin)' })
  setRoles(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserRolesDto) {
    return this.users.setRoles(id, dto);
  }

  @Patch(':id/status')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Activa/desactiva un usuario (admin)' })
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserStatusDto) {
    return this.users.setStatus(id, dto);
  }
}
