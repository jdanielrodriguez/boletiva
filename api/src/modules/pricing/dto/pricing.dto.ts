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
