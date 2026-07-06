import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class HoldSeatsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50) // tope por carrito (anti-abuso)
  @IsUUID(undefined, { each: true })
  seatIds!: string[];
}
