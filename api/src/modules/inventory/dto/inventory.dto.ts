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
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50) // tope por carrito (anti-abuso)
  @IsUUID(undefined, { each: true })
  seatIds!: string[];
}

/** Reserva por CANTIDAD (admisión general): el servidor asigna N cupos. */
export class HoldQuantityDto {
  @IsUUID()
  localityId!: string;

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
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  seatIds?: string[];

  @IsOptional()
  @IsUUID()
  localityId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  quantity?: number;
}
