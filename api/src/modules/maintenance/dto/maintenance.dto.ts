import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Cuerpo para activar/desactivar el mantenimiento (admin). */
export class UpdateMaintenanceDto {
  @ApiProperty({ description: 'true = activa el mantenimiento; false = lo desactiva' })
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({
    description: 'Mensaje opcional para el usuario mientras dure el mantenimiento',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

/** Estado público del modo mantenimiento. */
export class MaintenanceStatusDto {
  @ApiProperty({ description: 'true si la plataforma está en mantenimiento' })
  enabled!: boolean;

  @ApiProperty({ nullable: true, description: 'Mensaje a mostrar (null si no hay)' })
  message!: string | null;
}
