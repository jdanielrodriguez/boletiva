import { ApiProperty } from '@nestjs/swagger';

/**
 * DTOs de respuesta del módulo de inventario (holds). SOLO documentación:
 * modelan fielmente lo que devuelve `SeatHoldService`.
 */

/** Resultado de una reserva temporal (hold) — `HoldResult`. */
export class HoldResponseDto {
  @ApiProperty({
    type: String,
    isArray: true,
    format: 'uuid',
    description: 'Asientos reservados (concretos, aun en modo por cantidad)',
    example: ['a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d'],
  })
  seatIds!: string[];

  @ApiProperty({ description: 'Dueño de la reserva (userId)', format: 'uuid' })
  holderId!: string;

  @ApiProperty({ example: 600, description: 'TTL de la reserva en segundos' })
  ttlSeconds!: number;

  @ApiProperty({
    format: 'date-time',
    example: '2026-07-08T18:40:00.000Z',
    description: 'Momento en que la reserva expira automáticamente',
  })
  expiresAt!: string;
}

/** Resultado de liberar holds propios. */
export class ReleaseHoldResponseDto {
  @ApiProperty({ example: 2, description: 'Cantidad de holds liberados que eran del solicitante' })
  released!: number;
}
