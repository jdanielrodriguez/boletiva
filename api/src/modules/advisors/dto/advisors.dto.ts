import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** Fila del panel de asesores. */
export class AdvisorRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ type: String, nullable: true }) firstName!: string | null;
  @ApiProperty({ type: String, nullable: true }) lastName!: string | null;
  @ApiProperty({ enum: ['active', 'inactive', 'pending'] }) status!: string;
  @ApiProperty({ description: 'true = deshabilitado (sin el rol advisor)' }) disabled!: boolean;
  @ApiProperty({ description: 'Cuenta creada al invitar (sin contraseña propia)' }) forced!: boolean;
  @ApiProperty() createdAt!: string;
}

/** Notificación manual a un asesor. */
export class NotifyAdvisorDto {
  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title!: string;

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}
