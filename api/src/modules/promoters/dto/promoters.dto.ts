import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PromoterStatus, Role } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class PromoterDecisionDto {
  @ApiPropertyOptional({ description: 'Motivo de rechazo/suspensión' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class SetRequireApprovalDto {
  @ApiProperty({ description: 'true = exigir autorización de admin; false = modo pruebas' })
  @IsBoolean()
  requireApproval!: boolean;
}

// ---------------------------------------------------------------------------
// Respuestas (contrato para el SDK del frontend). Solo documentación.
// ---------------------------------------------------------------------------

/** Estado de promotor de un usuario (resumen tras solicitar/aprobar/rechazar/suspender). */
export class PromoterStatusResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: PromoterStatus })
  promoterStatus!: PromoterStatus;

  @ApiProperty({ format: 'date-time', nullable: true, description: 'Cuándo solicitó ser promotor' })
  promoterAppliedAt!: Date | null;

  @ApiProperty({ format: 'date-time', nullable: true, description: 'Cuándo el admin decidió' })
  promoterDecidedAt!: Date | null;

  @ApiProperty({ type: String, nullable: true, description: 'Motivo de rechazo/suspensión' })
  promoterNote!: string | null;
}

/** Mi estado de promotor + si el modo de autorización está activo. */
export class MyPromoterStatusResponseDto extends PromoterStatusResponseDto {
  @ApiProperty({ description: 'true = se exige autorización de admin; false = modo pruebas' })
  requireApproval!: boolean;
}

/** Config de autorización de promotores. */
export class RequireApprovalResponseDto {
  @ApiProperty({ description: 'true = se exige autorización de admin; false = modo pruebas' })
  requireApproval!: boolean;
}

/** Fila del panel de solicitudes de promotor (admin). */
export class PromoterListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;

  @ApiProperty({ enum: Role, isArray: true })
  roles!: Role[];

  @ApiProperty({ enum: PromoterStatus })
  promoterStatus!: PromoterStatus;

  @ApiProperty({ format: 'date-time', nullable: true })
  promoterAppliedAt!: Date | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  promoterDecidedAt!: Date | null;

  @ApiProperty({ type: String, nullable: true })
  promoterNote!: string | null;
}

/** Fila del historial append-only de estados de un promotor. */
export class PromoterStatusEventDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  promoterId!: string;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'Admin que ejecutó (null = sistema)' })
  adminId!: string | null;

  @ApiProperty({ enum: PromoterStatus })
  statusFrom!: PromoterStatus;

  @ApiProperty({ enum: PromoterStatus })
  statusTo!: PromoterStatus;

  @ApiProperty({ type: String, nullable: true, description: 'Motivo de la transición' })
  reason!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}
