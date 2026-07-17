import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PromoterStatus, Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequireCaptcha } from '../../common/decorators/require-captcha.decorator';
import { CaptchaGuard } from '../../common/guards/captcha.guard';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { RequireVerifiedEmail } from '../../common/decorators/verified-email.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from '../auth/auth.service';
import { setRefreshCookie } from '../auth/refresh-cookie';
import { PromotersService } from './promoters.service';
import {
  ApplyPromoterDto,
  MyPromoterStatusResponseDto,
  PromoterDecisionDto,
  PromoterInternalNoteResponseDto,
  PromoterListItemDto,
  PromoterHistoryItemDto,
  PromoterStatusResponseDto,
  RegisterPromoterDto,
  RequireApprovalResponseDto,
  SetPromoterNoteDto,
  SetRequireApprovalDto,
} from './dto/promoters.dto';

@ApiTags('promoters')
@ApiBearerAuth()
@Controller('promoters')
export class PromotersController {
  constructor(
    private readonly promoters: PromotersService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('apply')
  @UseGuards(CaptchaGuard)
  @RequireCaptcha('promoter_apply')
  @RequireVerifiedEmail()
  @HttpCode(200)
  @ApiOperation({ summary: 'Solicita darse de alta como promotor (auto-aprueba en modo pruebas)' })
  @ApiOkResponse({ type: PromoterStatusResponseDto })
  apply(@CurrentUser('userId') userId: string, @Body() dto: ApplyPromoterDto) {
    return this.promoters.apply(userId, dto.tier);
  }

  @Public()
  @UseGuards(CaptchaGuard)
  @RequireCaptcha('promoter_register')
  @RateLimit({ limit: 5, windowSec: 60 })
  @Post('register')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Registro + alta como promotor en un paso (visitante). En modo pruebas queda aprobado al instante.',
  })
  async register(
    @Body() dto: RegisterPromoterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const signup = await this.auth.signup(
      { email: dto.email, password: dto.password, firstName: dto.firstName },
      { deviceId: req.headers['x-device-id'] as string | undefined, userAgent: req.headers['user-agent'], ip: req.ip },
    );
    setRefreshCookie(res, this.config, signup.tokens?.refreshToken);
    const promoter = await this.promoters.apply(signup.user.id, dto.tier);
    return { ...signup, promoter };
  }

  @Get('me')
  @ApiOperation({ summary: 'Mi estado de promotor' })
  @ApiOkResponse({ type: MyPromoterStatusResponseDto })
  me(@CurrentUser('userId') userId: string) {
    return this.promoters.myStatus(userId);
  }

  @Get('settings')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Config de autorización de promotores (admin)' })
  @ApiOkResponse({ type: RequireApprovalResponseDto })
  async settings() {
    return { requireApproval: await this.promoters.requireApproval() };
  }

  @Patch('settings')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Activa/desactiva la exigencia de autorización — "Activar pruebas" (admin)' })
  @ApiOkResponse({ type: RequireApprovalResponseDto })
  setSettings(@Body() dto: SetRequireApprovalDto) {
    return this.promoters.setRequireApproval(dto.requireApproval);
  }

  @Get()
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Lista de solicitudes de promotor (admin), filtrable por estado' })
  @ApiOkResponse({ type: PromoterListItemDto, isArray: true })
  list(@Query('status') status?: string) {
    if (status && !(status in PromoterStatus)) {
      throw new BadRequestException('Estado de promotor inválido');
    }
    return this.promoters.list(status as PromoterStatus | undefined);
  }

  @Post(':id/approve')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Aprueba (o reactiva) un promotor (admin)' })
  @ApiOkResponse({ type: PromoterStatusResponseDto })
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('userId') adminId: string) {
    return this.promoters.approve(id, adminId);
  }

  @Post(':id/reject')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Rechaza una solicitud de promotor (admin)' })
  @ApiOkResponse({ type: PromoterStatusResponseDto })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PromoterDecisionDto,
    @CurrentUser('userId') adminId: string,
  ) {
    return this.promoters.reject(id, dto.note, adminId);
  }

  @Post(':id/suspend')
  @Roles(Role.admin)
  @HttpCode(200)
  @ApiOperation({ summary: 'Suspende a un promotor (admin)' })
  @ApiOkResponse({ type: PromoterStatusResponseDto })
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PromoterDecisionDto,
    @CurrentUser('userId') adminId: string,
  ) {
    return this.promoters.suspend(id, dto.note, adminId);
  }

  @Get(':id/history')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Historial append-only de estados de un promotor (admin)' })
  @ApiOkResponse({ type: PromoterHistoryItemDto, isArray: true })
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.promoters.history(id);
  }

  @Patch(':id/note')
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Fija/borra la nota interna del admin sobre un promotor (admin)' })
  @ApiOkResponse({ type: PromoterInternalNoteResponseDto })
  setNote(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPromoterNoteDto) {
    return this.promoters.setInternalNote(id, dto.note ?? null);
  }
}
