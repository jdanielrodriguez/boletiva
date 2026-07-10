import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SeatTemplateKind } from '@prisma/client';
import { IsEnum, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSeatTemplateDto {
  @ApiProperty({ description: 'Nombre de la plantilla', example: 'Auditorio central' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ enum: SeatTemplateKind, default: SeatTemplateKind.custom })
  @IsOptional()
  @IsEnum(SeatTemplateKind)
  kind?: SeatTemplateKind;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Geometría/metadata de la plantilla (icono, hint, layout).',
  })
  @IsOptional()
  @IsObject()
  layoutJson?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Parámetros de generación (filas, columnas, radio, etc.).',
  })
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}

export class UpdateSeatTemplateDto {
  @ApiPropertyOptional({ example: 'Auditorio central' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: SeatTemplateKind })
  @IsOptional()
  @IsEnum(SeatTemplateKind)
  kind?: SeatTemplateKind;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  layoutJson?: Record<string, unknown>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}

export class SeatTemplateResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Filas rectas' })
  name!: string;

  @ApiProperty({ enum: SeatTemplateKind })
  kind!: SeatTemplateKind;

  @ApiProperty({ type: 'object', additionalProperties: true })
  layoutJson!: Record<string, unknown>;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  params!: Record<string, unknown> | null;

  @ApiProperty({ description: 'Plantilla del sistema (no editable/borrable)' })
  isBuiltIn!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
