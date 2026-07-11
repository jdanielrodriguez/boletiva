import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';

/** Usuario efectivo de la sesión impersonada. */
export class ImpersonationUserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email', example: 'promotor@pasaeventos.com' })
  email!: string;

  @ApiProperty({ enum: Role, isArray: true })
  roles!: Role[];
}

/** Token de impersonación de vida corta (soporte). */
export class ImpersonationResponseDto {
  @ApiProperty({ description: 'Access token de vida corta que actúa como el promotor' })
  accessToken!: string;

  @ApiProperty({ example: 1800, description: 'Vigencia del token en segundos' })
  expiresIn!: number;

  @ApiProperty({ format: 'uuid', description: 'Admin que inició la impersonación' })
  impersonatedBy!: string;

  @ApiProperty({ type: ImpersonationUserDto })
  user!: ImpersonationUserDto;
}
