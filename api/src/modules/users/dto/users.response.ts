import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role, UserStatus } from '@prisma/client';

/**
 * Forma pública de un usuario tal como la retorna `UsersService` (selección
 * `publicSelect`). NUNCA expone `passwordHash`, secretos TOTP ni tokens.
 * Solo documentación para el OpenAPI/SDK; no altera el runtime.
 */
export class UserResponseDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'Identificador del usuario',
    example: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  })
  id!: string;

  @ApiProperty({
    description: 'Correo electrónico (único)',
    example: 'cliente@pasaeventos.com',
  })
  email!: string;

  @ApiProperty({ description: 'Nombre', example: 'Juan' })
  firstName!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Apellido',
    example: 'Pérez',
  })
  lastName!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Teléfono de contacto',
    example: '+502 5555 5555',
  })
  phone!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'URL del avatar',
    example: 'https://cdn.pasaeventos.com/avatars/juan.png',
  })
  avatarUrl!: string | null;

  @ApiProperty({
    enum: Role,
    isArray: true,
    description: 'Roles asignados al usuario',
    example: [Role.buyer],
  })
  roles!: Role[];

  @ApiProperty({
    enum: UserStatus,
    description: 'Estado de la cuenta',
    example: UserStatus.active,
  })
  status!: UserStatus;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Fecha del último inicio de sesión',
    example: '2026-07-08T12:34:56.000Z',
  })
  lastLoginAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Fecha de creación de la cuenta',
    example: '2026-07-01T09:00:00.000Z',
  })
  createdAt!: string;
}

/** Página keyset de usuarios: `{ items, nextCursor }`. */
export class UserPageResponseDto {
  @ApiProperty({ type: UserResponseDto, isArray: true, description: 'Usuarios de la página' })
  items!: UserResponseDto[];

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Cursor para la siguiente página (id de la última fila); null si no hay más',
    example: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  })
  nextCursor!: string | null;
}
