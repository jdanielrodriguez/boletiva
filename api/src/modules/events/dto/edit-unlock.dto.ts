import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class EditUnlockVerifyDto {
  @ApiProperty({ description: 'Código OTP de 6 dígitos enviado al correo del admin', example: '123456' })
  @IsString()
  @Length(6, 6)
  code!: string;
}

export class EditUnlockRequestedDto {
  @ApiProperty({ example: true })
  sent!: boolean;
}

export class EditUnlockTokenDto {
  @ApiProperty({ description: 'Token de desbloqueo (header x-edit-unlock en las mutaciones)' })
  token!: string;

  @ApiProperty({ format: 'date-time', description: 'Expiración del token (5 min)' })
  expiresAt!: string;
}
