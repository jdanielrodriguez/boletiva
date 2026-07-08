import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';

export class SetDefaultPctDto {
  @ApiProperty({ description: 'Reparto por defecto (0.5 = 50%; 0 = plataforma cubre todo)' })
  @IsNumber()
  @Min(0)
  @Max(1)
  pct!: number;
}

export class SetPromoterPctDto {
  @ApiProperty({ description: '% que asume el promotor (0..1)' })
  @IsNumber()
  @Min(0)
  @Max(1)
  pct!: number;
}

// ---------------------------------------------------------------------------
// Respuestas (contrato para el SDK del frontend). Solo documentación.
// ---------------------------------------------------------------------------

/** Reparto por defecto de gastos extra (setting global). */
export class DefaultPctResponseDto {
  @ApiProperty({
    example: 0.5,
    description: 'Reparto por defecto (0.5 = 50%; 0 = plataforma cubre todo)',
  })
  defaultPct!: number;
}

/** Reparto EFECTIVO de un promotor (su override si existe, o el default global). */
export class PromoterEffectivePctResponseDto {
  @ApiProperty({ format: 'uuid' })
  promoterId!: string;

  @ApiProperty({ example: 0.5, description: '% efectivo que asume el promotor (0..1)' })
  effectivePct!: number;
}

/** Resultado de fijar/quitar el override de reparto de un promotor. */
export class PromoterCostSharePctResponseDto {
  @ApiProperty({ format: 'uuid' })
  promoterId!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 0.3,
    description: 'Override del promotor (null = usa el default global)',
  })
  override!: number | null;

  @ApiProperty({ example: 0.5, description: '% efectivo resultante (0..1)' })
  effectivePct!: number;
}
