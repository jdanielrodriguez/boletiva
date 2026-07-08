import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsPositive, IsString, Max, MaxLength, Min } from 'class-validator';

/** Porcentaje válido para comisiones: [0, 1). */
const PCT = { min: 0, max: 0.99999 };

export class CreateFeeScheduleDto {
  @ApiProperty({ description: 'Comisión de plataforma sobre el neto (0.10 = 10%)', example: 0.1 })
  @IsNumber()
  @Min(PCT.min)
  @Max(PCT.max)
  platformFeePct!: number;

  @ApiProperty({ description: 'Comisión de la pasarela sobre el total (0.05 = 5%)', example: 0.05 })
  @IsNumber()
  @Min(PCT.min)
  @Max(PCT.max)
  gatewayFeePct!: number;

  @ApiProperty({ description: 'IVA sobre la base gravable (0.12 = 12% GT)', example: 0.12 })
  @IsNumber()
  @Min(PCT.min)
  @Max(PCT.max)
  ivaPct!: number;

  @ApiPropertyOptional({ description: 'Cargos fijos que se suman a la base gravable', example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  fixedFees?: number;

  @ApiPropertyOptional({ description: 'Etiqueta descriptiva de la versión' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

export class QuoteQueryDto {
  @ApiProperty({ description: 'Neto deseado por el promotor', example: 100 })
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  net!: number;
}

// ---------------------------------------------------------------------------
// Respuestas (solo documentación OpenAPI; no cambian el comportamiento).
// Dinero SIEMPRE como string (Decimal serializado) para no perder precisión.
// ---------------------------------------------------------------------------

/** Parámetros de comisiones con los que se calculó una cotización. */
export class FeeParamsResponseDto {
  @ApiProperty({ description: 'Comisión de plataforma sobre el neto (0.10 = 10%)', example: 0.1 })
  platformFeePct!: number;

  @ApiProperty({ description: 'Comisión de la pasarela sobre el total (0.05 = 5%)', example: 0.05 })
  gatewayFeePct!: number;

  @ApiProperty({ description: 'IVA sobre la base gravable (0.12 = 12% GT)', example: 0.12 })
  ivaPct!: number;

  @ApiPropertyOptional({
    description: 'true (default): IVA sobre neto + comisión plataforma; false: solo comisión',
    example: true,
  })
  ivaOnNet?: boolean;

  @ApiPropertyOptional({ description: 'Cargos fijos que se suman a la base gravable', example: 0 })
  fixedFees?: number;
}

/**
 * Desglose de precio (PriceQuote). Server-authoritative, con hash anti-manipulación.
 * Los campos de cuotas están ausentes en pago único (retrocompatibilidad).
 */
export class PriceQuoteResponseDto {
  @ApiProperty({ example: 'GTQ', enum: ['GTQ'] })
  currency!: 'GTQ';

  @ApiProperty({ type: String, description: 'Neto que recibe el promotor', example: '100.00' })
  net!: string;

  @ApiProperty({ type: String, example: '0.00' })
  fixedFees!: string;

  @ApiProperty({
    type: String,
    description: 'Comisión de plataforma (absorbe el residuo de redondeo)',
    example: '10.00',
  })
  platformFee!: string;

  @ApiProperty({
    type: String,
    description: 'Base gravable = net + platformFee + fixedFees',
    example: '110.00',
  })
  taxableBase!: string;

  @ApiProperty({ type: String, description: 'IVA declarado sobre la base gravable', example: '13.20' })
  iva!: string;

  @ApiProperty({
    type: String,
    description: 'Comisión real que la plataforma paga a la pasarela',
    example: '6.48',
  })
  gatewayFee!: string;

  @ApiProperty({
    type: String,
    description: 'Cuota por servicio (comprador) = plataforma + pasarela (+ fijos) = total − net − iva',
    example: '16.48',
  })
  serviceFee!: string;

  @ApiProperty({ type: String, description: 'Precio final all-in del comprador', example: '129.68' })
  total!: string;

  @ApiProperty({ description: 'Total en centavos', example: 12968 })
  totalCents!: number;

  @ApiProperty({ type: FeeParamsResponseDto })
  params!: FeeParamsResponseDto;

  @ApiPropertyOptional({ description: 'Número de cuotas seleccionadas (>= 2)', example: 3 })
  installments?: number;

  @ApiPropertyOptional({ description: 'Comisión de pasarela aplicada por las cuotas (gn)', example: 0.08 })
  installmentFeePct?: number;

  @ApiPropertyOptional({
    type: String,
    description: 'Cargo fijo de la pasarela por transacción en cuotas',
    example: '2.00',
  })
  installmentFixedFee?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Precio de referencia en 1 pago (el comprador paga igual)',
    example: '129.68',
  })
  basePrice?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Costo de financiamiento absorbido (no lo paga el comprador)',
    example: '4.90',
  })
  installmentSurcharge?: string;

  @ApiPropertyOptional({
    description: 'Quién absorbe el costo de las cuotas (nunca el comprador)',
    enum: ['platform', 'promoter'],
    example: 'platform',
  })
  installmentAbsorbedBy?: 'platform' | 'promoter';

  @ApiProperty({ description: 'SHA-256 de params + resultado (anti-manipulación)' })
  hash!: string;
}

/** Versión de comisiones (fee_schedule). Los porcentajes se serializan como string. */
export class FeeScheduleResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Número de versión (único, incremental)', example: 1 })
  version!: number;

  @ApiProperty({ type: String, nullable: true, example: 'v1 inicial' })
  label!: string | null;

  @ApiProperty({ type: String, description: 'Comisión de plataforma (0.10 = 10%)', example: '0.10000' })
  platformFeePct!: string;

  @ApiProperty({ type: String, description: 'Comisión de pasarela default (0.05 = 5%)', example: '0.05000' })
  gatewayFeePct!: string;

  @ApiProperty({ type: String, description: 'IVA (0.12 = 12% GT)', example: '0.12000' })
  ivaPct!: string;

  @ApiProperty({ type: String, description: 'Cargos fijos', example: '0.00' })
  fixedFees!: string;

  @ApiProperty({ description: 'Si es la versión activa', example: true })
  active!: boolean;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  createdById!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

/** Respuesta de `GET /pricing/quote`: versión de comisiones + desglose. */
export class QuoteResponseDto {
  @ApiProperty({ type: Number, nullable: true, description: 'Versión de comisiones usada', example: 1 })
  feeScheduleVersion!: number | null;

  @ApiProperty({ type: PriceQuoteResponseDto })
  quote!: PriceQuoteResponseDto;
}
