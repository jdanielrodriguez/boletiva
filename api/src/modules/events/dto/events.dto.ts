import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Descripción compartida del flag de absorción de cuotas (transparencia frontend). */
const ABSORB_DESC =
  'Si el PROMOTOR absorbe el costo de las cuotas (se descuenta de su neto). ' +
  'false/omitir = lo absorbe la PLATAFORMA. El comprador paga igual en ambos casos.';

export class CreateEventDto {
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsOptional()
  @IsUUID()
  gatewayId?: string;

  @IsOptional()
  @IsBoolean()
  ivaOnNet?: boolean;

  @ApiPropertyOptional({ description: ABSORB_DESC, default: false })
  @IsOptional()
  @IsBoolean()
  absorbInstallmentCost?: boolean;
}

export class UpdateEventDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsUUID()
  gatewayId?: string;

  @IsOptional()
  @IsBoolean()
  ivaOnNet?: boolean;

  @ApiPropertyOptional({ description: ABSORB_DESC, default: false })
  @IsOptional()
  @IsBoolean()
  absorbInstallmentCost?: boolean;
}
