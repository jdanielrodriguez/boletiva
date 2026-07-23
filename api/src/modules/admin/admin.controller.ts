import { Controller, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminOnly } from '../../common/decorators/admin-only.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { MessageResponseDto } from '../../common/dto/response.dto';
import { clientIp } from '../../common/utils/client-ip';
import { ImpersonationService } from './impersonation.service';
import { ImpersonationResponseDto } from './dto/impersonation.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminController {
  constructor(private readonly impersonation: ImpersonationService) {}

  // La ruta estática `impersonate/stop` se declara ANTES de `impersonate/:userId`
  // para que Express no intente parsear "stop" como un UUID.
  @Post('impersonate/stop')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Termina la impersonación (deja rastro en la bitácora). Se llama con el token impersonado.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  stop(@CurrentUser() user: AuthUser, @Req() req: Request): Promise<MessageResponseDto> {
    return this.impersonation.stop(user, {
      ip: clientIp(req),
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
  }

  @Post('impersonate/:userId')
  @Roles(Role.admin)
  @AdminOnly()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Emite un token de vida corta para actuar como un promotor (soporte). Solo admin; ' +
      'no impersona a otros admins; auditado.',
  })
  @ApiOkResponse({ type: ImpersonationResponseDto })
  start(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser('userId') adminId: string,
    @Req() req: Request,
  ): Promise<ImpersonationResponseDto> {
    return this.impersonation.start(adminId, userId, {
      ip: clientIp(req),
      userAgent: (req.headers['user-agent'] as string) ?? null,
    });
  }
}
