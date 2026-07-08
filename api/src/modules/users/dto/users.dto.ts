import { ApiPropertyOptional } from '@nestjs/swagger';
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
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsUrl()
  avatarUrl?: string;
}

export class UpdateUserRolesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(Role, { each: true })
  roles!: Role[];
}

export class UpdateUserStatusDto {
  @IsEnum(UserStatus)
  status!: UserStatus;
}
