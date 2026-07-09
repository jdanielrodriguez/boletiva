import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireVerifiedEmail } from '../../common/decorators/verified-email.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { PromoterInvitationsService } from './promoter-invitations.service';
import {
  ClaimInvitationDto,
  CreateInvitationsDto,
  CreateInvitationsResponseDto,
  InvitationListItemDto,
  InvitationPeekDto,
  InvitationRevokedDto,
} from './dto/promoter-invitations.dto';

@ApiTags('promoters')
@ApiBearerAuth()
@Controller('promoters/invitations')
export class PromoterInvitationsController {
  constructor(private readonly invitations: PromoterInvitationsService) {}

  @Post()
  @Roles(Role.admin, Role.promoter)
  @RequireVerifiedEmail()
  @ApiOperation({ summary: 'Invita a uno o varios correos como promotor (genera URLs con token)' })
  @ApiOkResponse({ type: CreateInvitationsResponseDto })
  create(@Body() dto: CreateInvitationsDto, @CurrentUser('userId') userId: string) {
    return this.invitations.create(dto.emails, userId);
  }

  @Get()
  @Roles(Role.admin, Role.promoter)
  @ApiOperation({ summary: 'Mis invitaciones (admin ve todas)' })
  @ApiOkResponse({ type: InvitationListItemDto, isArray: true })
  list(@CurrentUser() user: AuthUser) {
    return this.invitations.list(user.userId, user.roles.includes(Role.admin));
  }

  @Get('peek')
  @Public()
  @ApiOperation({ summary: 'Vista pública para precargar el registro (valida el token)' })
  @ApiOkResponse({ type: InvitationPeekDto })
  peek(@Query('token') token: string) {
    return this.invitations.peek(token);
  }

  @Post('accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Acepta la invitación: el usuario queda auto-aprobado como promotor' })
  accept(@Body() dto: ClaimInvitationDto, @CurrentUser('userId') userId: string) {
    return this.invitations.accept(dto.token, userId);
  }

  @Delete(':id')
  @Roles(Role.admin, Role.promoter)
  @ApiOperation({ summary: 'Revoca una invitación pendiente' })
  @ApiOkResponse({ type: InvitationRevokedDto })
  revoke(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.invitations.revoke(id, user.userId, user.roles.includes(Role.admin));
  }
}
