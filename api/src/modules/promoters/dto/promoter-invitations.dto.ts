import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PromoterInvitationStatus } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateInvitationsDto {
  @ApiProperty({
    type: [String],
    description: 'Correos a invitar como promotor (uno o varios)',
    example: ['nuevo@promotor.com', 'otro@promotor.com'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  emails!: string[];

  @ApiPropertyOptional({
    default: false,
    description:
      'Marca a los invitados como usuarios de PRUEBA: al aceptar, quedan anclados a Sandbox ' +
      '(no pueden usar pasarelas reales). Útil para alpha/beta sin contaminar métricas de prod.',
  })
  @IsOptional()
  @IsBoolean()
  isTestUser?: boolean;
}

export class ClaimInvitationDto {
  @ApiProperty({ description: 'Token de invitación (de la URL)' })
  @IsString()
  token!: string;
}

/** Invitación creada: incluye la URL con token (se muestra una sola vez). */
export class CreatedInvitationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'nuevo@promotor.com' })
  email!: string;

  @ApiProperty({ description: 'Token en claro (solo aquí)', example: 'a1b2c3…' })
  token!: string;

  @ApiProperty({ description: 'URL de registro con el token', example: 'https://app/registro?token=…' })
  url!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

export class CreateInvitationsResponseDto {
  @ApiProperty({ type: [CreatedInvitationDto] })
  invitations!: CreatedInvitationDto[];
}

/** Invitación en el listado (sin token). */
export class InvitationListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'nuevo@promotor.com' })
  email!: string;

  @ApiProperty({ enum: PromoterInvitationStatus })
  status!: PromoterInvitationStatus;

  @ApiProperty({ description: 'Invitado como usuario de prueba (anclado a Sandbox)' })
  isTestUser!: boolean;

  @ApiProperty({ format: 'uuid' })
  invitedById!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  acceptedByUserId!: string | null;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  acceptedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class InvitationPeekDto {
  @ApiProperty({ example: 'nuevo@promotor.com', description: 'Correo al que se invitó' })
  email!: string;

  @ApiProperty({ example: true })
  valid!: boolean;
}

export class InvitationByTokenDto {
  @ApiProperty({ example: 'nuevo@promotor.com', description: 'Correo al que se invitó' })
  email!: string;

  @ApiProperty({
    example: true,
    description: 'Si ya existe una cuenta con ese correo (→ iniciar sesión y aceptar, sin registro)',
  })
  accountExists!: boolean;

  @ApiProperty({ example: true })
  valid!: boolean;
}

export class InvitationAcceptedDto {
  @ApiProperty({ example: true })
  accepted!: boolean;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Estado de promotor resultante',
  })
  promoter!: Record<string, unknown>;
}

export class InvitationRevokedDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: PromoterInvitationStatus })
  status!: PromoterInvitationStatus;
}
