import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WithdrawalStatus } from '@prisma/client';
import { IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

// ---------------------------------------------------------------------------
// DTOs de RESPUESTA (solo documentación OpenAPI; el runtime devuelve objetos
// planos desde los services). Los montos son Decimal → SIEMPRE string.
// ---------------------------------------------------------------------------

/** Saldo interno del usuario (`GET /wallet`). */
export class WalletBalanceResponseDto {
  @ApiProperty({ type: String, example: '100.00', description: 'Saldo disponible del wallet (GTQ)' })
  balance!: string;

  @ApiProperty({ example: 'GTQ', description: 'Moneda del saldo' })
  currency!: string;
}

/**
 * Retiro en un listado keyset (`GET /wallet/withdrawals[/all]`): fila cruda de
 * `wallet_withdrawals`. Los Decimal se serializan como string.
 */
export class WithdrawalResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Identificador del retiro' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'Usuario dueño del retiro' })
  userId!: string;

  @ApiProperty({ type: String, example: '100.00', description: 'Monto bruto a debitar del wallet (GTQ)' })
  amount!: string;

  @ApiProperty({ type: String, example: '0.06000', description: 'Porcentaje de comisión aplicado (fracción)' })
  feePct!: string;

  @ApiProperty({ type: String, example: '6.00', description: 'Comisión retenida (GTQ)' })
  fee!: string;

  @ApiProperty({ type: String, example: '94.00', description: 'Neto que recibe el usuario (amount - fee)' })
  net!: string;

  @ApiProperty({ example: 'GTQ', description: 'Moneda del retiro' })
  currency!: string;

  @ApiProperty({ enum: WithdrawalStatus, description: 'Estado del retiro' })
  status!: WithdrawalStatus;

  @ApiProperty({ type: String, nullable: true, description: 'Motivo de rechazo / referencia de pago' })
  note!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'Admin que decidió el retiro' })
  decidedById!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, description: 'Fecha de decisión (aprobación/rechazo)' })
  decidedAt!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, description: 'Fecha de pago externo' })
  paidAt!: string | null;

  @ApiProperty({ format: 'date-time', description: 'Fecha de creación de la solicitud' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', description: 'Fecha de última actualización' })
  updatedAt!: string;
}

/** Página keyset de retiros: `{ items, nextCursor }`. */
export class WithdrawalPageResponseDto {
  @ApiProperty({ type: [WithdrawalResponseDto], description: 'Retiros de la página' })
  items!: WithdrawalResponseDto[];

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Cursor (id de la última fila) para la página siguiente; null si no hay más',
  })
  nextCursor!: string | null;
}

/**
 * Retiro devuelto por las acciones (`POST` solicitud/approve/pay/reject,
 * `DELETE` cancel): resumen de `summarize()` — nótese que `feePct` es number
 * aquí y no se incluyen `currency`/`decidedById`/`decidedAt`/`updatedAt`.
 */
export class WithdrawalActionResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Identificador del retiro' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'Usuario dueño del retiro' })
  userId!: string;

  @ApiProperty({ type: String, example: '100.00', description: 'Monto bruto a debitar del wallet (GTQ)' })
  amount!: string;

  @ApiProperty({ type: String, example: '6.00', description: 'Comisión retenida (GTQ)' })
  fee!: string;

  @ApiProperty({ type: String, example: '94.00', description: 'Neto que recibe el usuario (amount - fee)' })
  net!: string;

  @ApiProperty({ type: Number, example: 0.06, description: 'Porcentaje de comisión aplicado (fracción)' })
  feePct!: number;

  @ApiProperty({ enum: WithdrawalStatus, description: 'Estado del retiro' })
  status!: WithdrawalStatus;

  @ApiProperty({ type: String, nullable: true, description: 'Motivo de rechazo / referencia de pago' })
  note!: string | null;

  @ApiProperty({ format: 'date-time', description: 'Fecha de creación de la solicitud' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', nullable: true, description: 'Fecha de pago externo' })
  paidAt!: string | null;
}

/** Query admin de retiros: paginación keyset + filtro por estado. */
export class WithdrawalsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: WithdrawalStatus })
  @IsOptional()
  @IsEnum(WithdrawalStatus)
  status?: WithdrawalStatus;
}

export class RequestWithdrawalDto {
  @ApiProperty({ description: 'Monto bruto a retirar del saldo (GTQ)', example: 100 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  amount!: number;
}

export class WithdrawalDecisionDto {
  @ApiPropertyOptional({ description: 'Motivo de rechazo o referencia de pago' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
