import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SignupDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72) // límite de bcrypt
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;
}

export class VerifyEmailCodeDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code!: string;
}

export class TokenDto {
  @IsString()
  @MinLength(1)
  token!: string;
}

export class ResendVerificationDto {
  @IsEmail()
  email!: string;
}

export class PasswordlessRequestDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;
}

export class PasswordlessVerifyDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code!: string;
}

export class TwoFactorVerifyDto {
  @IsString()
  @MinLength(1)
  preauthToken!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code!: string;
}

export class EnableTotpDto {
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code!: string;
}

export class GoogleLoginDto {
  @IsString()
  @MinLength(1)
  idToken!: string;
}
