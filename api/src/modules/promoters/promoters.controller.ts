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
import { AdminOnly } from '../../common/decorators/admin-only.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequireCaptcha } from '../../common/decorators/require-captcha.decorator';
import { CaptchaGuard } from '../../common/guards/captcha.guard';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { RequireVerifiedEmail } from '../../common/decorators/verified-email.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from '../auth/auth.service';
import { setRefreshCookie } from '../auth/refresh-cookie';
import { PromotersService } from './promoters.service';
import { PremiumService } from './premium.service';
import {
  AdminSetTierDto,
  ApplyPromoterDto,
  MyPromoterStatusResponseDto,
  PremiumTierResponseDto,
  PromoterDecisionDto,
  PromoterInternalNoteResponseDto,
  PromoterListItemDto,
  PromoterHistoryItemDto,
  PromoterStatusResponseDto,
  RegisterPromoterDto,
  RequireApprovalResponseDto,
  SetPromoterNoteDto,
  SetRequireApprovalDto,
  SetTierDto,
} from './dto/promoters.dto';

@ApiTags('promoters')
@ApiBearerAuth()
@Controller('promoters')
export class PromotersController {
  constructor(
    private readonly promoters: PromotersService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly premium: PremiumService,
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
    // Anti-enumeración (M-01): si el correo ya existe, signup no crea cuenta ni sesión
    // (devuelve `pending`). Respondemos 202 genérico — el dueño real recibe por correo el
    // aviso con opciones de iniciar sesión y darse de alta como promotor desde su cuenta.
    if ('pending' in signup) {
      res.status(202);
      return {
        message:
          'Si el correo es válido, te enviamos instrucciones para continuar. Revisa tu bandeja de entrada.',
      };
    }
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

  @Post('tier')
  @RequireVerifiedEmail()
  @HttpCode(200)
  @ApiOperation({ summary: 'Cambia mi plan de promotor (upgrade/downgrade). Premium exige tarjeta registrada.' })
  @ApiOkResponse({ type: PremiumTierResponseDto })
  setMyTier(@CurrentUser('userId') userId: string, @Body() dto: SetTierDto) {
    return this.premium.setTier(userId, dto.tier);
  }

  @Patch(':id/tier')
  @Roles(Role.admin)
  @AdminOnly() // otorgar Premium/prueba gratis es monetario → solo admin real, no el asesor (QA)
  @ApiOperation({ summary: 'Fija el plan de un promotor a mano (admin): premium directo o prueba de N días' })
  @ApiOkResponse({ type: PremiumTierResponseDto })
  adminSetTier(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminSetTierDto) {
    return this.premium.setTier(id, dto.tier, { byAdmin: true, trialDays: dto.trialDays });
  }

  @Post('premium/expire-trials')
  @Roles(Role.admin)
  @AdminOnly()
  @HttpCode(200)
  @ApiOperation({ summary: 'Baja a free las pruebas premium vencidas (disparo manual; también corre a diario)' })
  expireTrials() {
    return this.premium.expireTrials().then((expired) => ({ expired }));
  }

  @Get('settings')
  @Roles(Role.admin)
  @AdminOnly()
  @ApiOperation({ summary: 'Config de autorización de promotores (admin)' })
  @ApiOkResponse({ type: RequireApprovalResponseDto })
  async settings() {
    return { requireApproval: await this.promoters.requireApproval() };
  }

  @Patch('settings')
  @Roles(Role.admin)
  @AdminOnly() // "Activar pruebas" (auto-aprobar promotores) es una perilla de gobernanza → solo admin
  @ApiOperation({ summary: 'Activa/desactiva la exigencia de autorización — "Activar pruebas" (admin)' })
  @ApiOkResponse({ type: RequireApprovalResponseDto })
  setSettings(@Body() dto: SetRequireApprovalDto) {
    return this.promoters.setRequireApproval(dto.requireApproval);
  }

  @Get()
  @Roles(Role.admin)
  @ApiOperation({ summary: 'Lista de solicitudes de promotor (admin), filtrable por estado' })
  @ApiOkResponse({ type: PromoterListItemDto, isArray: true })
  list(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    if (status && !(status in PromoterStatus)) {
      throw new BadRequestException('Estado de promotor inválido');
    }
    const take = limit ? Math.min(Math.max(parseInt(limit, 10) || 0, 1), 100) : undefined;
    return this.promoters.list(status as PromoterStatus | undefined, search?.trim() || undefined, take);
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
