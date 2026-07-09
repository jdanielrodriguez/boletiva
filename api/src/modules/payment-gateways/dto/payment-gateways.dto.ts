import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GatewayStatus } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateGatewayDto {
  @ApiProperty({ example: 'Recurrente' })
  @IsString()
  @MaxLength(60)
  name!: string;

  @ApiProperty({
    example: 'recurrente',
    description: "Proveedor: 'simulator' | 'recurrente' | 'pagalo' | 'stripe'...",
  })
  @IsString()
  @MaxLength(40)
  provider!: string;

  @ApiProperty({ description: 'Comisión de la pasarela en 1 pago (0.05 = 5%)', example: 0.05 })
  @IsNumber()
  @Min(0)
  @Max(0.99999)
  feePct!: number;

  @ApiPropertyOptional({
    description:
      'Cargo FIJO por transacción de la pasarela (GTQ, p.ej. Q2 de Recurrente). Aplica a TODO cobro (1 pago y cuotas).',
    example: 2,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  transactionFixedFee?: number;

  @ApiPropertyOptional({
    description:
      'Cost-share mínimo del promotor para usar esta pasarela (0.5 = 50%). La default de plataforma debe ser 0.',
    example: 0.5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  minCostSharePct?: number;

  @ApiPropertyOptional({
    description:
      'Comisión por cuotas: mapa cuotas→tasa, p.ej. {"3":0.08,"6":0.09,"12":0.10,"18":0.14}',
    example: { '3': 0.08, '6': 0.09, '12': 0.1, '18': 0.14 },
  })
  @IsOptional()
  @IsObject()
  installmentRates?: Record<string, number>;

  @ApiPropertyOptional({
    description: 'Cargo fijo por transacción en cuotas (GTQ, p.ej. 2)',
    example: 2,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  installmentFixedFee?: number;

  @ApiPropertyOptional({ description: 'Referencia al secreto (Secret Manager/env), no el secreto' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  credentialsRef?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  sandbox?: boolean;
}

export class UpdateGatewayDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ example: 0.05 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(0.99999)
  feePct?: number;

  @ApiPropertyOptional({ description: 'Cargo fijo por transacción (GTQ). Aplica a todo cobro.', example: 2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  transactionFixedFee?: number;

  @ApiPropertyOptional({
    description: 'Cost-share mínimo del promotor para usar esta pasarela (0-1). La default debe ser 0.',
    example: 0.5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  minCostSharePct?: number;

  @ApiPropertyOptional({
    description: 'Comisión por cuotas: mapa cuotas→tasa. {} borra las cuotas.',
    example: { '3': 0.08, '6': 0.09, '12': 0.1, '18': 0.14 },
  })
  @IsOptional()
  @IsObject()
  installmentRates?: Record<string, number>;

  @ApiPropertyOptional({ description: 'Cargo fijo por transacción en cuotas (GTQ)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  installmentFixedFee?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  credentialsRef?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  sandbox?: boolean;
}

export class UpdateGatewayStatusDto {
  @ApiProperty({ enum: GatewayStatus })
  @IsEnum(GatewayStatus)
  status!: GatewayStatus;
}

// ---------------------------------------------------------------------------
// Respuestas (contrato para el SDK del frontend). Solo documentación.
// ---------------------------------------------------------------------------

/** Pasarela de pago configurada (fiel al modelo Prisma `payment_gateways`). */
export class GatewayResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Recurrente' })
  name!: string;

  @ApiProperty({
    example: 'recurrente',
    description: "Proveedor: 'simulator' | 'recurrente' | 'pagalo' | 'stripe'...",
  })
  provider!: string;

  @ApiProperty({
    type: String,
    example: '0.05',
    description: 'Comisión de la pasarela en 1 pago (Decimal serializado como string)',
  })
  feePct!: string;

  @ApiProperty({
    type: String,
    example: '2.00',
    description: 'Cargo fijo por transacción (GTQ). Aplica a todo cobro (1 pago y cuotas).',
  })
  transactionFixedFee!: string;

  @ApiProperty({
    type: String,
    example: '0.00',
    description: 'Cost-share mínimo del promotor para usar esta pasarela. La default = 0.',
  })
  minCostSharePct!: string;

  @ApiProperty({
    type: 'object',
    nullable: true,
    additionalProperties: { type: 'number' },
    example: { '3': 0.08, '6': 0.09, '12': 0.1, '18': 0.14 },
    description: 'Comisión por cuotas: mapa cuotas→tasa. null = sin cuotas.',
  })
  installmentRates!: Record<string, number> | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2.00',
    description: 'Cargo fijo por transacción en cuotas (GTQ). null = sin fijo.',
  })
  installmentFixedFee!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Referencia al secreto (Secret Manager/env), no el secreto',
  })
  credentialsRef!: string | null;

  @ApiProperty({ enum: GatewayStatus })
  status!: GatewayStatus;

  @ApiProperty({ description: '¿Es la pasarela default de plataforma?' })
  isPlatformDefault!: boolean;

  @ApiProperty()
  sandbox!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

/** Resultado de eliminar una pasarela: id borrado y default a la que migraron los eventos. */
export class GatewayDeleteResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Id de la pasarela eliminada' })
  deleted!: string;

  @ApiProperty({ format: 'uuid', description: 'Id de la pasarela default a la que se migraron los eventos' })
  migratedTo!: string;
}
