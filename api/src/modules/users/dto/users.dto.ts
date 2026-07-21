import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role, UserStatus } from '@prisma/client';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

/** Idiomas soportados por la UI (preferencia persistida del usuario). */
export const SUPPORTED_LANGUAGES = ['es', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Franjas de tema que el usuario puede preferir (el tema concreto lo resuelve el admin). */
export const THEME_FRANJAS = ['dia', 'noche'] as const;
export type ThemeFranja = (typeof THEME_FRANJAS)[number];
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

  @ApiPropertyOptional({
    description: 'Preferencia de idioma de la interfaz',
    enum: SUPPORTED_LANGUAGES,
    example: 'es',
  })
  @IsOptional()
  @IsIn(SUPPORTED_LANGUAGES)
  language?: SupportedLanguage;

  @ApiPropertyOptional({
    description: 'Preferencia de franja de tema (día/noche). El tema concreto lo resuelve el admin.',
    enum: THEME_FRANJAS,
    example: 'noche',
  })
  @IsOptional()
  @IsIn(THEME_FRANJAS)
  themePref?: ThemeFranja;

  @ApiPropertyOptional({
    description: 'Recibir notificaciones por correo (negocio/soporte). No afecta a los correos de seguridad.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  emailNotificationsEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'NIT para facturación (FEL). Vacío = sin NIT (se factura como CF). Necesario para facturar a nombre.',
    example: '1234567-8',
    maxLength: 20,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  nit?: string | null;

  @ApiPropertyOptional({
    description: 'Nombre fiscal para la factura (idealmente autocompletado por el NIT).',
    example: 'Juan Pérez',
    maxLength: 150,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  billingName?: string | null;

  @ApiPropertyOptional({
    description: 'DPI (opcional). No requerido para facturar.',
    example: '2954812340101',
    maxLength: 20,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  dpi?: string | null;
}

export class MarkTourDto {
  @ApiProperty({ description: 'Clave del tour a marcar como visto', example: 'home', maxLength: 40 })
  @IsString()
  @MaxLength(40)
  tour!: string;
}

export class AvatarPresignDto {
  @ApiProperty({ description: 'Nombre del archivo (para derivar la extensión)', example: 'foto.jpg' })
  @IsString()
  @MaxLength(200)
  filename!: string;

  @ApiProperty({ description: 'MIME type de la imagen', example: 'image/jpeg' })
  @IsString()
  @MaxLength(100)
  contentType!: string;
}

export class SetAvatarDto {
  @ApiProperty({ description: 'Key del objeto subido (devuelta por el presign)', example: 'avatars/uuid/xxx.jpg' })
  @IsString()
  @MaxLength(300)
  key!: string;
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
