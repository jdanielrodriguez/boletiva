import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { EditUnlockService } from './edit-unlock.service';
import {
  EditUnlockRequestedDto,
  EditUnlockTokenDto,
  EditUnlockVerifyDto,
} from './dto/edit-unlock.dto';

@ApiTags('events')
@ApiBearerAuth()
@Controller('events/:id/edit-unlock')
export class EventEditUnlockController {
  constructor(private readonly editUnlock: EditUnlockService) {}

  @Post('request')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Envía un código OTP al admin para desbloquear la edición del evento' })
  @ApiOkResponse({ type: EditUnlockRequestedDto })
  request(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthUser) {
    return this.editUnlock.request(admin, id);
  }

  @Post('verify')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Verifica el OTP y devuelve un token de desbloqueo (5 min)' })
  @ApiOkResponse({ type: EditUnlockTokenDto })
  verify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditUnlockVerifyDto,
    @CurrentUser() admin: AuthUser,
  ) {
    return this.editUnlock.verify(admin, id, dto.code);
  }
}
