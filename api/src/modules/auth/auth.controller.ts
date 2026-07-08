import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MessageResponseDto } from '../../common/dto/response.dto';
import { AuthService } from './auth.service';
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
  TwoFactorVerifyDto,
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
} from './dto/auth.response';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly twofactor: TwoFactorService,
    private readonly devices: DevicesService,
  ) {}

  private ctx(req: Request): DeviceContext {
    return {
      deviceId: req.headers['x-device-id'] as string | undefined,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    };
  }

  // ---- Registro / login ----

  @Public()
  @Post('signup')
  @ApiOperation({ summary: 'Registro con correo y contraseña (envía verificación)' })
  @ApiCreatedResponse({ type: SignupResponseDto })
  signup(@Body() dto: SignupDto, @Req() req: Request) {
    return this.auth.signup(dto, this.ctx(req));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login por contraseña (puede requerir 2FA en dispositivo nuevo)' })
  @ApiOkResponse({ type: LoginResponseDto })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, this.ctx(req));
  }

  @Public()
  @Post('2fa/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Completa el login enviando el segundo factor' })
  @ApiOkResponse({ type: AuthSessionResponseDto })
  verify2fa(@Body() dto: TwoFactorVerifyDto, @Req() req: Request) {
    return this.auth.verifyTwoFactor(dto.preauthToken, dto.code, this.ctx(req));
  }

  // ---- Verificación de correo ----

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verifica el correo con el código de 6 dígitos' })
  @ApiOkResponse({ type: PublicUserResponseDto })
  verifyEmail(@Body() dto: VerifyEmailCodeDto) {
    return this.auth.verifyEmailByCode(dto.email, dto.code);
  }

  @Public()
  @Post('verify-email/token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verifica el correo con el token del enlace mágico' })
  @ApiOkResponse({ type: PublicUserResponseDto })
  verifyEmailToken(@Body() dto: TokenDto) {
    return this.auth.verifyEmailByToken(dto.token);
  }

  @Public()
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
  @Post('passwordless/request')
  @HttpCode(202)
  @ApiOperation({ summary: 'Solicita acceso solo con correo (enlace + código)' })
  @ApiAcceptedResponse({ type: MessageResponseDto })
  async passwordlessRequest(@Body() dto: PasswordlessRequestDto) {
    await this.auth.passwordlessRequest(dto.email, dto.firstName);
    return { message: 'Te enviamos un enlace y un código para entrar.' };
  }

  @Public()
  @Post('passwordless/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Entra con el código enviado al correo' })
  @ApiOkResponse({ type: AuthSessionResponseDto })
  passwordlessVerify(@Body() dto: PasswordlessVerifyDto, @Req() req: Request) {
    return this.auth.passwordlessVerifyCode(dto.email, dto.code, this.ctx(req));
  }

  @Public()
  @Post('passwordless/token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Entra con el token del enlace mágico' })
  @ApiOkResponse({ type: AuthSessionResponseDto })
  passwordlessToken(@Body() dto: TokenDto, @Req() req: Request) {
    return this.auth.passwordlessVerifyToken(dto.token, this.ctx(req));
  }

  // ---- Google ----

  @Public()
  @Post('google')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login con Google (id_token del cliente)' })
  @ApiOkResponse({ type: AuthSessionResponseDto })
  google(@Body() dto: GoogleLoginDto, @Req() req: Request) {
    return this.auth.googleLogin(dto.idToken, this.ctx(req));
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
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, this.ctx(req));
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cierra la sesión' })
  @ApiNoContentResponse()
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }

  @Public()
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
  @ApiOperation({ summary: 'Perfil del usuario autenticado' })
  @ApiOkResponse({ type: PublicUserResponseDto })
  me(@CurrentUser('userId') userId: string) {
    return this.auth.me(userId);
  }

  // ---- Gestión de 2FA ----

  @Post('2fa/totp/setup')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Inicia el alta de TOTP (devuelve QR y secret)' })
  @ApiCreatedResponse({ type: TotpSetupResponseDto })
  totpSetup(@CurrentUser('userId') userId: string) {
    return this.twofactor.setupTotp(userId);
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
