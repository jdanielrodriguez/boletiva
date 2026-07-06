import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GatewayStatus } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateGatewayDto {
  @ApiProperty({ example: 'Pagalo' })
  @IsString()
  @MaxLength(60)
  name!: string;

  @ApiProperty({
    example: 'pagalo',
    description: "Proveedor: 'simulator' | 'pagalo' | 'stripe'...",
  })
  @IsString()
  @MaxLength(40)
  provider!: string;

  @ApiProperty({ description: 'Comisión de la pasarela (0.05 = 5%)', example: 0.05 })
  @IsNumber()
  @Min(0)
  @Max(0.99999)
  feePct!: number;

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
