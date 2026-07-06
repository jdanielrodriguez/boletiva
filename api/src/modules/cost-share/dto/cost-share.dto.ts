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
