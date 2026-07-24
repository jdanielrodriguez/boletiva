import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
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
  // Endpoint PÚBLICO (checkout por token de reserva): validar tipo+longitud como en
  // CheckoutDto. Sin @IsString un `{billingName:{...}}` provocaba TypeError 500 al
  // hacer .trim(), y una cadena enorme se persistía sin cota (QA).
  @ApiPropertyOptional({ description: 'NIT para facturación FEL; vacío = CF (consumidor final)' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  billingNit?: string;

  @ApiPropertyOptional({ description: 'Nombre de facturación FEL' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  billingName?: string;

  @ApiPropertyOptional({ description: 'Dirección de facturación FEL' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
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

  @ApiProperty({ example: '12', description: 'Asiento/etiqueta del cupo' })
  label!: string;

  @ApiPropertyOptional({ nullable: true, example: 'Mesa 3', description: 'Mesa o zona (si aplica)' })
  section!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'A', description: 'Fila (si aplica)' })
  row!: string | null;

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

export class ReservationCooldownDto {
  @ApiProperty({ description: 'true si el visitante está en cooldown tras cancelar una reserva' })
  onCooldown!: boolean;

  @ApiProperty({ description: 'true si ya tiene una reserva anónima activa (por IP)' })
  hasActive!: boolean;

  @ApiProperty({ description: 'Segundos restantes de cooldown (0 si no aplica). Autoritativo: úsalo para el cronómetro.' })
  retryAfterSeconds!: number;
}
