import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** Cupos de una localidad general (admisión por cantidad). */
export class ReservationQuantityDto {
  @ApiProperty({ format: 'uuid', description: 'Localidad general' })
  @IsUUID()
  localityId!: string;

  @ApiProperty({ example: 2, minimum: 1, maximum: 50, description: 'Cantidad de cupos' })
  @IsInt()
  @Min(1)
  @Max(50)
  quantity!: number;
}

/**
 * Crea una reserva anónima. Puede combinar VARIAS localidades a la vez:
 * `seatIds` (asientos numerados, de una o varias localidades) y/o `quantities`
 * (cupos de una o varias localidades generales). `localityId`+`quantity` se
 * mantienen como atajo para una sola localidad general.
 */
export class CreateReservationDto {
  @ApiPropertyOptional({
    type: String,
    isArray: true,
    format: 'uuid',
    description: 'Asientos numerados a reservar (1–50, de una o varias localidades)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  seatIds?: string[];

  @ApiPropertyOptional({ format: 'uuid', description: 'Atajo de una sola localidad general' })
  @IsOptional()
  @IsUUID()
  localityId?: string;

  @ApiPropertyOptional({ example: 2, minimum: 1, maximum: 50, description: 'Cantidad (con localityId)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  quantity?: number;

  @ApiPropertyOptional({
    type: () => ReservationQuantityDto,
    isArray: true,
    description: 'Cupos por localidad general (permite varias localidades a la vez)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ReservationQuantityDto)
  quantities?: ReservationQuantityDto[];
}

/** Datos de facturación FEL al pagar una reserva (opcionales; sin NIT → CF). */
export class CheckoutReservationDto {
  @ApiPropertyOptional({ description: 'NIT para facturación FEL; vacío = CF (consumidor final)' })
  @IsOptional()
  billingNit?: string;

  @ApiPropertyOptional({ description: 'Nombre de facturación FEL' })
  @IsOptional()
  billingName?: string;

  @ApiPropertyOptional({ description: 'Dirección de facturación FEL' })
  @IsOptional()
  billingAddress?: string;
}

// --- Respuestas ---

export class ReservationPriceDto {
  @ApiProperty({ example: 'GTQ' })
  currency!: string;

  @ApiProperty({ type: String, example: '100.00' })
  net!: string;

  @ApiProperty({ type: String, example: '16.48' })
  serviceFee!: string;

  @ApiProperty({ type: String, example: '13.20' })
  iva!: string;

  @ApiProperty({ type: String, example: '129.68' })
  total!: string;
}

export class ReservationItemDto {
  @ApiProperty({ format: 'uuid' })
  seatId!: string;

  @ApiProperty({ example: 'GA-12' })
  label!: string;

  @ApiProperty({ format: 'uuid' })
  localityId!: string;

  @ApiProperty({ example: 'General' })
  localityName!: string;

  @ApiProperty({ type: () => ReservationPriceDto })
  price!: ReservationPriceDto;
}

export class ReservationResponseDto {
  @ApiProperty({ description: 'Token firmado de la reserva (para compartir/pagar)' })
  token!: string;

  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ example: 'Concierto de Apertura' })
  eventName!: string;

  @ApiProperty({ example: 'concierto-de-apertura' })
  eventSlug!: string;

  @ApiProperty({ format: 'date-time' })
  startsAt!: string;

  @ApiProperty({ description: 'true si la reserva sigue viva (holds vigentes)' })
  valid!: boolean;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'Cuándo expira la reserva' })
  expiresAt!: string | null;

  @ApiProperty({ example: 'GTQ' })
  currency!: string;

  @ApiProperty({ type: String, example: '259.36' })
  total!: string;

  @ApiProperty({ type: () => ReservationItemDto, isArray: true })
  items!: ReservationItemDto[];
}
