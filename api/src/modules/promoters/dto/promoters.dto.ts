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

/** Nota interna del admin sobre un promotor (v3.8). null/omitir = borra la nota. */
export class SetPromoterNoteDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Nota interna del admin (máx 2000). null/omitir = borra la nota.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
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

/** Resultado de fijar/borrar la nota interna de un promotor (admin, v3.8). */
export class PromoterInternalNoteResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Nota interna del admin' })
  promoterInternalNote!: string | null;
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

  @ApiProperty({ type: String, nullable: true, description: 'Nota interna del admin' })
  promoterInternalNote!: string | null;
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

/**
 * Ítem del historial del promotor: unifica transiciones de ESTADO (`kind:'status'`) y
 * LIQUIDACIONES de caja (`kind:'settlement'`, con `eventName` + `amount` transferido).
 */
export class PromoterHistoryItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['status', 'settlement'] })
  kind!: 'status' | 'settlement';

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'Admin que ejecutó (solo status; null = sistema)' })
  adminId!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Estado origen (solo status)' })
  statusFrom!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Estado destino (solo status)' })
  statusTo!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Motivo / memo' })
  reason!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Evento liquidado (solo settlement)' })
  eventName!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Neto transferido en GTQ (solo settlement)' })
  amount!: string | null;
}
