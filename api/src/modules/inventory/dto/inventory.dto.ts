import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/** Reserva por ASIENTO (localidad numerada): el cliente indica los seatIds. */
export class HoldSeatsDto {
  @ApiProperty({
    type: String,
    isArray: true,
    format: 'uuid',
    description: 'Asientos a reservar (1–50, tope por carrito anti-abuso)',
    example: ['a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50) // tope por carrito (anti-abuso)
  @IsUUID(undefined, { each: true })
  seatIds!: string[];
}

/** Reserva por CANTIDAD (admisión general): el servidor asigna N cupos. */
export class HoldQuantityDto {
  @ApiProperty({ format: 'uuid', description: 'Localidad general de la que se toman los cupos' })
  @IsUUID()
  localityId!: string;

  @ApiProperty({ example: 2, minimum: 1, maximum: 50, description: 'Cantidad de cupos a reservar' })
  @IsInt()
  @Min(1)
  @Max(50) // tope por carrito (anti-abuso), alineado con seated
  quantity!: number;
}

/**
 * Body unificado del endpoint de holds: o bien `seatIds` (numerada) o bien
 * `localityId`+`quantity` (general). El controller enruta según el modo.
 */
export class CreateHoldDto {
  @ApiPropertyOptional({
    type: String,
    isArray: true,
    format: 'uuid',
    description: 'Modo numerado: asientos a reservar (1–50). Excluyente con localityId+quantity',
    example: ['a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  seatIds?: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Modo general: localidad de la que se toman los cupos (con quantity)',
  })
  @IsOptional()
  @IsUUID()
  localityId?: string;

  @ApiPropertyOptional({
    example: 2,
    minimum: 1,
    maximum: 50,
    description: 'Modo general: cantidad de cupos a reservar (con localityId)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  quantity?: number;
}
