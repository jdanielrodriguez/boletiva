import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTOs de RESPUESTA del módulo auth. Son SOLO de documentación (OpenAPI → SDK
 * tipado del frontend): no cambian el comportamiento en tiempo de ejecución.
 * Cada clase refleja FIELMENTE la forma que retorna el service correspondiente.
 */

/** Par de tokens emitido al iniciar sesión / rotar (`TokenPair`). */
export class TokenPairResponseDto {
  @ApiProperty({
    description: 'JWT de acceso (Bearer) de vida corta',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken!: string;

  @ApiProperty({
    description: 'Refresh token opaco para rotar la sesión (se guarda hasheado en BD)',
    example: 'a3f1c9e2b47d8f0a1c2e3b4d5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a',
  })
  refreshToken!: string;

  @ApiProperty({
    description: 'Vigencia del access token en segundos',
    example: 900,
  })
  expiresIn!: number;
}

/** Usuario público (`PublicUser`): perfil sin datos sensibles. */
export class PublicUserResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Identificador del usuario', example: '3f1a2b3c-4d5e-6f70-8a9b-0c1d2e3f4a5b' })
  id!: string;

  @ApiProperty({ description: 'Correo electrónico', example: 'cliente@pasaeventos.com' })
  email!: string;

  @ApiProperty({ description: 'Nombre', example: 'Ana' })
  firstName!: string;

  @ApiPropertyOptional({ description: 'Apellido', example: 'García', nullable: true })
  lastName!: string | null;

  @ApiPropertyOptional({ description: 'Teléfono', example: '+50255551234', nullable: true })
  phone!: string | null;

  @ApiPropertyOptional({
    description: 'URL del avatar',
    example: 'https://cdn.pasaeventos.com/avatars/ana.png',
    nullable: true,
  })
  avatarUrl!: string | null;

  @ApiProperty({
    description: 'Roles del usuario',
    isArray: true,
    enum: ['admin', 'promoter', 'promoter_staff', 'gate_operator', 'buyer'],
    example: ['buyer'],
  })
  roles!: string[];

  @ApiProperty({
    description: 'Estado de la cuenta',
    enum: ['active', 'inactive', 'pending'],
    example: 'active',
  })
  status!: string;

  @ApiProperty({ description: '¿El correo está verificado?', example: true })
  emailVerified!: boolean;

  @ApiProperty({
    description: 'Método de segundo factor configurado',
    enum: ['email', 'totp'],
    example: 'email',
  })
  twoFactorMethod!: string;

  @ApiProperty({
    description: 'Preferencia de idioma de la interfaz',
    enum: ['es', 'en'],
    example: 'es',
  })
  language!: string;

  @ApiPropertyOptional({
    description: 'Preferencia de franja de tema (día/noche); null = default de la plataforma',
    enum: ['dia', 'noche'],
    example: 'noche',
    nullable: true,
  })
  themePref?: string | null;

  @ApiPropertyOptional({ description: 'Recibir notificaciones por correo (negocio/soporte).', example: true })
  emailNotificationsEnabled?: boolean;

  @ApiProperty({
    description: 'Usuario de PRUEBA (invitado en modo test): eventos anclados a Sandbox, sin cargos reales',
    example: false,
  })
  isTestUser!: boolean;

  @ApiPropertyOptional({ description: 'NIT de facturación (FEL)', example: '1234567-8', nullable: true })
  nit?: string | null;

  @ApiPropertyOptional({ description: 'Nombre fiscal para la factura', example: 'Juan Pérez', nullable: true })
  billingName?: string | null;

  @ApiPropertyOptional({ description: 'DPI (opcional)', example: '2954812340101', nullable: true })
  dpi?: string | null;

  @ApiProperty({ description: 'Tours de onboarding ya vistos', type: [String], example: [] })
  toursSeen!: string[];

  @ApiProperty({ description: 'Plan del promotor', enum: ['free', 'premium'], example: 'free' })
  promoterTier!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Solo en /auth/me bajo un token de IMPERSONACIÓN (v3.8): id del admin que actúa ' +
      'como este usuario. El frontend lo usa para el banner "estás viendo como X".',
  })
  impersonatedBy?: string;
}

/** Resultado de `signup`: usuario recién creado + par de tokens (sin `status`). */
export class SignupResponseDto {
  @ApiProperty({ type: () => PublicUserResponseDto, description: 'Usuario registrado' })
  user!: PublicUserResponseDto;

  @ApiProperty({ type: () => TokenPairResponseDto, description: 'Par de tokens de la sesión' })
  tokens!: TokenPairResponseDto;
}

/** Sesión iniciada correctamente: `{ status: 'ok', user, tokens }`. */
export class AuthSessionResponseDto {
  @ApiProperty({ description: 'Resultado del login', enum: ['ok'], example: 'ok' })
  status!: 'ok';

  @ApiProperty({ type: () => PublicUserResponseDto, description: 'Usuario autenticado' })
  user!: PublicUserResponseDto;

  @ApiProperty({ type: () => TokenPairResponseDto, description: 'Par de tokens de la sesión' })
  tokens!: TokenPairResponseDto;
}

/**
 * Resultado de `login`: unión de dos casos.
 * - `status: 'ok'` → incluye `user` y `tokens`.
 * - `status: '2fa_required'` → incluye `method` y `preauthToken` (sin tokens).
 */
export class LoginResponseDto {
  @ApiProperty({
    description: 'Resultado del intento de login',
    enum: ['ok', '2fa_required'],
    example: 'ok',
  })
  status!: 'ok' | '2fa_required';

  @ApiPropertyOptional({
    type: () => PublicUserResponseDto,
    description: 'Usuario autenticado (solo cuando status = ok)',
  })
  user?: PublicUserResponseDto;

  @ApiPropertyOptional({
    type: () => TokenPairResponseDto,
    description: 'Par de tokens de la sesión (solo cuando status = ok)',
  })
  tokens?: TokenPairResponseDto;

  @ApiPropertyOptional({
    description: 'Método de segundo factor requerido (solo cuando status = 2fa_required)',
    enum: ['email', 'totp'],
    example: 'email',
  })
  method?: string;

  @ApiPropertyOptional({
    description: 'Token de pre-autenticación para completar el 2FA (solo cuando status = 2fa_required)',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  preauthToken?: string;
}

/** Métodos de acceso disponibles (`GET /auth/providers`). */
export class ProvidersResponseDto {
  @ApiProperty({ description: '¿Acceso con correo y contraseña habilitado?', example: true })
  password!: boolean;

  @ApiProperty({ description: '¿Acceso sin contraseña (magic link + código) habilitado?', example: true })
  passwordless!: boolean;

  @ApiProperty({ description: '¿Login con Google habilitado?', example: false })
  google!: boolean;
}

/** Datos para dar de alta TOTP (`POST /auth/2fa/totp/setup`). */
export class TotpSetupResponseDto {
  @ApiProperty({
    description: 'URL otpauth:// para configurar la app autenticadora',
    example: 'otpauth://totp/Pasa%20Eventos:ana@correo.com?secret=JBSWY3DPEHPK3PXP&issuer=Pasa%20Eventos',
  })
  otpauthUrl!: string;

  @ApiProperty({
    description: 'Código QR de la URL otpauth como data URL (PNG base64)',
    example: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
  })
  qrDataUrl!: string;

  @ApiProperty({
    description: 'Secreto TOTP en texto (para ingreso manual en la app)',
    example: 'JBSWY3DPEHPK3PXP',
  })
  secret!: string;
}

/** Dispositivo registrado del usuario (`GET /auth/devices`). */
export class DeviceResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Identificador del dispositivo', example: '9b0c1d2e-3f4a-5b6c-7d8e-9f0a1b2c3d4e' })
  id!: string;

  @ApiPropertyOptional({
    description: 'User-Agent del dispositivo',
    example: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    nullable: true,
  })
  userAgent!: string | null;

  @ApiPropertyOptional({ description: 'Dirección IP', example: '181.174.1.10', nullable: true })
  ip!: string | null;

  @ApiPropertyOptional({
    description: 'Fecha en que el dispositivo pasó a ser confiable (null si no lo es)',
    type: String,
    format: 'date-time',
    example: '2026-07-08T14:23:00.000Z',
    nullable: true,
  })
  trustedAt!: Date | null;

  @ApiProperty({
    description: 'Última vez que se vio el dispositivo',
    type: String,
    format: 'date-time',
    example: '2026-07-08T14:23:00.000Z',
  })
  lastSeenAt!: Date;

  @ApiProperty({
    description: 'Fecha de alta del dispositivo',
    type: String,
    format: 'date-time',
    example: '2026-07-01T09:00:00.000Z',
  })
  createdAt!: Date;
}
