import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SignupDto {
  @ApiProperty({ description: 'Correo electrónico único', example: 'ana@correo.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    description: 'Contraseña (8–72 caracteres; 72 = límite de bcrypt)',
    minLength: 8,
    maxLength: 72,
    example: 'Password123',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72) // límite de bcrypt
  password!: string;

  @ApiProperty({ description: 'Nombre', maxLength: 100, example: 'Ana' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @ApiPropertyOptional({ description: 'Apellido', maxLength: 100, example: 'García' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ description: 'Teléfono de contacto', maxLength: 30, example: '+50255551234' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}

export class LoginDto {
  @ApiProperty({ description: 'Correo electrónico registrado', example: 'ana@correo.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'Contraseña de la cuenta', example: 'Password123' })
  @IsString()
  @MinLength(1)
  password!: string;
}

export class RefreshDto {
  @ApiPropertyOptional({
    description:
      'Refresh token vigente a rotar/revocar. Opcional: el flujo web lo transporta ' +
      'en la cookie httpOnly `refresh_token`; este campo es el fallback para clientes no-web.',
    example: 'a3f1c9e2b47d8f0a1c2e3b4d5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  refreshToken?: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ description: 'Correo de la cuenta a recuperar', example: 'ana@correo.com' })
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({
    description: 'Token del enlace de recuperación recibido por correo',
    example: 'b7d2f4a6c8e0135792468acebdf013579246...',
  })
  @IsString()
  @MinLength(1)
  token!: string;

  @ApiProperty({
    description: 'Nueva contraseña (8–72 caracteres)',
    minLength: 8,
    maxLength: 72,
    example: 'NuevaClave456',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ description: 'Contraseña actual', example: 'Password123' })
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @ApiProperty({
    description: 'Nueva contraseña (8–72 caracteres)',
    minLength: 8,
    maxLength: 72,
    example: 'NuevaClave456',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;
}

export class VerifyEmailCodeDto {
  @ApiProperty({ description: 'Correo a verificar', example: 'ana@correo.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'Código de verificación de 6 dígitos', minLength: 6, maxLength: 6, example: '482913' })
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code!: string;
}

export class TokenDto {
  @ApiProperty({
    description: 'Token del enlace mágico recibido por correo',
    example: 'c9e2b47d8f0a1c2e3b4d5f6a7b8c9d0e1f2a3b4c...',
  })
  @IsString()
  @MinLength(1)
  token!: string;
}

export class ResendVerificationDto {
  @ApiProperty({ description: 'Correo al que reenviar la verificación', example: 'ana@correo.com' })
  @IsEmail()
  email!: string;
}

export class PasswordlessRequestDto {
  @ApiProperty({ description: 'Correo con el que acceder sin contraseña', example: 'ana@correo.com' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({
    description: 'Nombre a usar si la cuenta se crea en este acceso',
    maxLength: 100,
    example: 'Ana',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;
}

export class PasswordlessVerifyDto {
  @ApiProperty({ description: 'Correo que solicitó el acceso', example: 'ana@correo.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'Código de 6 dígitos enviado al correo', minLength: 6, maxLength: 6, example: '482913' })
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code!: string;
}

export class TwoFactorVerifyDto {
  @ApiProperty({
    description: 'Token de pre-autenticación devuelto por el login (status = 2fa_required)',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  @MinLength(1)
  preauthToken!: string;

  @ApiProperty({
    description: 'Código del segundo factor (app TOTP o código enviado por correo)',
    minLength: 6,
    maxLength: 6,
    example: '482913',
  })
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code!: string;
}

export class TwoFactorResendDto {
  @ApiProperty({
    description: 'Token de pre-autenticación devuelto por el login (status = 2fa_required)',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  @MinLength(1)
  preauthToken!: string;
}

export class EnableTotpDto {
  @ApiProperty({ description: 'Código de 6 dígitos generado por la app autenticadora', minLength: 6, maxLength: 6, example: '482913' })
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code!: string;
}

/** Step-up (B-02): re-autenticación con la contraseña actual para iniciar el alta de TOTP. */
export class TotpSetupDto {
  @ApiProperty({
    description: 'Contraseña actual (re-autenticación). Requerida si la cuenta tiene contraseña.',
    required: false,
    example: 'MiClaveActual123',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  password?: string;
}

export class GoogleLoginDto {
  @ApiProperty({
    description: 'id_token de Google obtenido en el cliente',
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjFh...',
  })
  @IsString()
  @MinLength(1)
  idToken!: string;
}
