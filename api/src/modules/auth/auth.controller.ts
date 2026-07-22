import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { RequireCaptcha } from '../../common/decorators/require-captcha.decorator';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { CaptchaGuard } from '../../common/guards/captcha.guard';
import { AllowDuringMaintenance } from '../../common/decorators/maintenance.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { MessageResponseDto } from '../../common/dto/response.dto';
import { AuthService } from './auth.service';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie';
import { newDeviceId, readDeviceCookie, setDeviceCookie } from './device-cookie';
import { TwoFactorService } from './twofactor.service';
import { DevicesService, DeviceContext } from './devices.service';
import {
  ChangePasswordDto,
  EnableTotpDto,
  ForgotPasswordDto,
  GoogleLoginDto,
  LoginDto,
  PasswordlessRequestDto,
  PasswordlessVerifyDto,
  RefreshDto,
  ResendVerificationDto,
  ResetPasswordDto,
  SignupDto,
  TokenDto,
  TotpSetupDto,
  TwoFactorVerifyDto,
  TwoFactorResendDto,
  VerifyEmailCodeDto,
} from './dto/auth.dto';
import {
  AuthSessionResponseDto,
  DeviceResponseDto,
  LoginResponseDto,
  ProvidersResponseDto,
  PublicUserResponseDto,
  SignupResponseDto,
  TokenPairResponseDto,
  TotpSetupResponseDto,
  TwoFactorResendResponseDto,
} from './dto/auth.response';

@ApiTags('auth')
@AllowDuringMaintenance()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly twofactor: TwoFactorService,
    private readonly devices: DevicesService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Contexto de dispositivo SOLO para metadatos de sesión (refresh/logout): no
   * resuelve ni persiste la identidad estable del dispositivo.
   */
  private ctx(req: Request): DeviceContext {
    return {
      deviceId: req.headers['x-device-id'] as string | undefined,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    };
  }

  /**
   * Contexto de dispositivo para los flujos de acceso (signup/login/2fa/passwordless/
   * google). Resuelve una identidad ESTABLE: header `X-Device-Id` (cliente que la
   * gestiona) → cookie `device_id` (navegador) → una nueva generada. Si no vino por
   * header, persiste/refresca la cookie httpOnly para que el mismo navegador se
   * reconozca en los siguientes logins y no repita 2FA.
   */
  private deviceCtx(req: Request, res: Response): DeviceContext {
    const header = (req.headers['x-device-id'] as string | undefined)?.trim();
    let deviceId = header;
    if (!deviceId) {
      deviceId = readDeviceCookie(req) ?? newDeviceId();
      setDeviceCookie(res, this.config, deviceId);
    }
    return { deviceId, userAgent: req.headers['user-agent'], ip: req.ip };
  }

  /**
   * Cuando el resultado del flujo trae tokens (login ok, 2fa ok, passwordless,
   * google, signup), estampa la cookie httpOnly con el refresh. Devuelve el mismo
   * resultado para no alterar el contrato del body (el refresh se mantiene ahí como
   * fallback no-web). Los resultados sin tokens (p.ej. `2fa_required`) se ignoran.
   */
  private issueCookie<T>(res: Response, result: T): T {
    const tokens = (result as { tokens?: { refreshToken?: string } }).tokens;
    setRefreshCookie(res, this.config, tokens?.refreshToken);
    return result;
  }

  // ---- Registro / login ----

  @Public()
  @UseGuards(CaptchaGuard)
  @RequireCaptcha('signup')
  @RateLimit({ limit: 5, windowSec: 60 })
  @Post('signup')
  @ApiOperation({ summary: 'Registro con correo y contraseña (envía verificación)' })
  @ApiCreatedResponse({ type: SignupResponseDto })
  @ApiAcceptedResponse({
    type: MessageResponseDto,
    description: 'Respuesta genérica anti-enumeración: el correo ya existe (se avisa por correo).',
  })
  async signup(
    @Body() dto: SignupDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.signup(dto, this.deviceCtx(req, res));
    // Anti-enumeración (M-01): correo ya existente → 202 genérico (sin sesión). El alta
    // real (correo nuevo) devuelve 201 + tokens y setea la cookie de refresh.
    if ('pending' in result) {
      res.status(202);
      return {
        message:
          'Si el correo es válido, te enviamos instrucciones para continuar. Revisa tu bandeja de entrada.',
      };
    }
    return this.issueCookie(res, result);
  }

  @Public()
  @UseGuards(CaptchaGuard)
  @RequireCaptcha('login')
  @RateLimit({ limit: 10, windowSec: 60 })
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login por contraseña (puede requerir 2FA en dispositivo nuevo)' })
  @ApiOkResponse({ type: LoginResponseDto })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.issueCookie(res, await this.auth.login(dto, this.deviceCtx(req, res)));
  }

  @Public()
  @RateLimit({ limit: 10, windowSec: 60 })
  @Post('2fa/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Completa el login enviando el segundo factor' })
  @ApiOkResponse({ type: AuthSessionResponseDto })
  async verify2fa(
    @Body() dto: TwoFactorVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.issueCookie(
      res,
      await this.auth.verifyTwoFactor(dto.preauthToken, dto.code, this.deviceCtx(req, res)),
    );
  }

  @Public()
  @RateLimit({ limit: 3, windowSec: 60 })
  @Post('2fa/resend')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reenvía el código del segundo factor por correo (solo método email)' })
  @ApiOkResponse({ type: TwoFactorResendResponseDto })
  resend2fa(@Body() dto: TwoFactorResendDto) {
    return this.auth.resendTwoFactor(dto.preauthToken);
  }

  // ---- Verificación de correo ----

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verifica el correo con el código de 6 dígitos' })
  @ApiOkResponse({ type: PublicUserResponseDto })
  verifyEmail(@Body() dto: VerifyEmailCodeDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.verifyEmailByCode(dto.email, dto.code, this.deviceCtx(req, res));
  }

  @Public()
  @Post('verify-email/token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verifica el correo con el token del enlace mágico' })
  @ApiOkResponse({ type: PublicUserResponseDto })
  verifyEmailToken(@Body() dto: TokenDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.verifyEmailByToken(dto.token, this.deviceCtx(req, res));
  }

  @Public()
  @UseGuards(CaptchaGuard)
  @RequireCaptcha('resend')
  @RateLimit({ limit: 3, windowSec: 60 })
  @Post('resend-verification')
  @HttpCode(202)
  @ApiOperation({ summary: 'Reenvía el correo de verificación' })
  @ApiAcceptedResponse({ type: MessageResponseDto })
  async resend(@Body() dto: ResendVerificationDto) {
    await this.auth.resendVerification(dto.email);
    return { message: 'Si aplica, reenviamos la verificación.' };
  }

  // ---- Passwordless ----

  @Public()
  @UseGuards(CaptchaGuard)
  @RequireCaptcha('passwordless')
  @RateLimit({ limit: 3, windowSec: 60 })
  @Post('passwordless/request')
  @HttpCode(202)
  @ApiOperation({ summary: 'Solicita acceso solo con correo (enlace + código)' })
  @ApiAcceptedResponse({ type: MessageResponseDto })
  async passwordlessRequest(@Body() dto: PasswordlessRequestDto) {
    await this.auth.passwordlessRequest(dto.email, dto.firstName);
    return { message: 'Te enviamos un enlace y un código para entrar.' };
  }

  @Public()
  @RateLimit({ limit: 10, windowSec: 60 })
  @Post('passwordless/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Entra con el código enviado al correo' })
  @ApiOkResponse({ type: AuthSessionResponseDto })
  async passwordlessVerify(
    @Body() dto: PasswordlessVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.issueCookie(
      res,
      await this.auth.passwordlessVerifyCode(dto.email, dto.code, this.deviceCtx(req, res)),
    );
  }

  @Public()
  @Post('passwordless/token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Entra con el token del enlace mágico' })
  @ApiOkResponse({ type: AuthSessionResponseDto })
  async passwordlessToken(
    @Body() dto: TokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.issueCookie(
      res,
      await this.auth.passwordlessVerifyToken(dto.token, this.deviceCtx(req, res)),
    );
  }

  // ---- Google ----

  @Public()
  @Post('google')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login con Google (id_token del cliente)' })
  @ApiOkResponse({ type: AuthSessionResponseDto })
  async google(
    @Body() dto: GoogleLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.issueCookie(res, await this.auth.googleLogin(dto.idToken, this.deviceCtx(req, res)));
  }

  @Public()
  @Get('providers')
  @ApiOperation({ summary: 'Métodos de acceso disponibles' })
  @ApiOkResponse({ type: ProvidersResponseDto })
  providers() {
    return { password: true, passwordless: true, google: this.auth.googleEnabled };
  }

  // ---- Sesión / cuenta ----

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rota el refresh token' })
  @ApiOkResponse({ type: TokenPairResponseDto })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // La cookie httpOnly es la fuente primaria; el body es el fallback no-web.
    const token = readRefreshCookie(req) ?? dto.refreshToken;
    if (!token) throw new UnauthorizedException('No hay refresh token');
    const pair = await this.auth.refresh(token, this.ctx(req));
    setRefreshCookie(res, this.config, pair.refreshToken); // re-set con el rotado
    return pair;
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cierra la sesión' })
  @ApiNoContentResponse()
  async logout(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = readRefreshCookie(req) ?? dto.refreshToken;
    if (token) await this.auth.logout(token);
    clearRefreshCookie(res, this.config);
  }

  @Public()
  @UseGuards(CaptchaGuard)
  @RequireCaptcha('forgot_password')
  @RateLimit({ limit: 5, windowSec: 60 })
  @Post('forgot-password')
  @HttpCode(202)
  @ApiOperation({ summary: 'Solicita recuperación de contraseña' })
  @ApiAcceptedResponse({ type: MessageResponseDto })
  async forgot(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto);
    return { message: 'Si el correo existe, enviamos instrucciones.' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Restablece la contraseña con el token' })
  @ApiOkResponse({ type: MessageResponseDto })
  async reset(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto);
    return { message: 'Contraseña actualizada.' };
  }

  @Post('change-password')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cambia la contraseña (autenticado)' })
  @ApiOkResponse({ type: MessageResponseDto })
  async change(@CurrentUser('userId') userId: string, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(userId, dto);
    return { message: 'Contraseña actualizada.' };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Perfil del usuario autenticado (expone impersonatedBy si es una sesión de soporte)' })
  @ApiOkResponse({ type: PublicUserResponseDto })
  async me(@CurrentUser() user: AuthUser) {
    const profile = await this.auth.me(user.userId);
    // Bajo un token de impersonación, el front necesita saber quién actúa (banner).
    return user.impersonation ? { ...profile, impersonatedBy: user.impersonatedBy } : profile;
  }

  // ---- Gestión de 2FA ----

  @Post('2fa/totp/setup')
  @RateLimit({ limit: 5, windowSec: 60 })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Inicia el alta de TOTP (devuelve QR y secret). Requiere re-autenticación.' })
  @ApiCreatedResponse({ type: TotpSetupResponseDto })
  totpSetup(@CurrentUser('userId') userId: string, @Body() dto: TotpSetupDto) {
    // B-02: step-up con la contraseña actual (si la cuenta tiene contraseña).
    return this.twofactor.setupTotp(userId, dto.password);
  }

  @Post('2fa/totp/enable')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirma TOTP con un código de la app' })
  @ApiOkResponse({ type: MessageResponseDto })
  async totpEnable(@CurrentUser('userId') userId: string, @Body() dto: EnableTotpDto) {
    await this.twofactor.enableTotp(userId, dto.code);
    return { message: 'TOTP activado.' };
  }

  @Post('2fa/use-email')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Usa el correo como segundo factor' })
  @ApiOkResponse({ type: MessageResponseDto })
  async useEmail(@CurrentUser('userId') userId: string) {
    await this.twofactor.useEmailMethod(userId);
    return { message: 'Segundo factor por correo activado.' };
  }

  // ---- Dispositivos ----

  @Get('devices')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Dispositivos del usuario' })
  @ApiOkResponse({ type: DeviceResponseDto, isArray: true })
  listDevices(@CurrentUser('userId') userId: string) {
    return this.devices.list(userId);
  }

  @Delete('devices/:id')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoca un dispositivo' })
  @ApiNoContentResponse()
  revokeDevice(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.devices.revoke(userId, id);
  }
}
