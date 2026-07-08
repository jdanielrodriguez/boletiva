import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role, UserStatus } from '@prisma/client';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

/** Query admin de usuarios: paginación keyset + búsqueda. */
export class UserListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Busca por email/nombre/apellido' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ description: 'Nombre', example: 'Juan', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ description: 'Apellido', example: 'Pérez', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({
    description: 'Teléfono de contacto',
    example: '+502 5555 5555',
    maxLength: 30,
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({
    description: 'URL del avatar',
    example: 'https://cdn.pasaeventos.com/avatars/juan.png',
  })
  @IsOptional()
  @IsUrl()
  avatarUrl?: string;
}

export class UpdateUserRolesDto {
  @ApiProperty({
    enum: Role,
    isArray: true,
    description: 'Roles a asignar (no vacío)',
    example: [Role.buyer, Role.promoter],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(Role, { each: true })
  roles!: Role[];
}

export class UpdateUserStatusDto {
  @ApiProperty({
    enum: UserStatus,
    description: 'Nuevo estado de la cuenta',
    example: UserStatus.inactive,
  })
  @IsEnum(UserStatus)
  status!: UserStatus;
}
