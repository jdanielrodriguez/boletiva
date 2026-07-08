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
