import { ApiProperty } from '@nestjs/swagger';
import { PromoterInvitationStatus } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsString } from 'class-validator';

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

export class InvitationRevokedDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: PromoterInvitationStatus })
  status!: PromoterInvitationStatus;
}
