import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MediaKind } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const TEMPLATES = ['aurora', 'midnight', 'sunset', 'forest', 'mono'] as const;

/** Opciones para generar el banner con IA (todas opcionales). */
export class GenerateBannerDto {
  @ApiPropertyOptional({
    description: 'Instrucción libre para el generador (tagline/estilo). Máx 500.',
    example: 'Ambiente neón, tipografía audaz, público saltando',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  prompt?: string;

  @ApiPropertyOptional({ enum: TEMPLATES, description: 'Plantilla visual (paleta/estilo)' })
  @IsOptional()
  @IsIn(TEMPLATES)
  template?: (typeof TEMPLATES)[number];

  @ApiPropertyOptional({
    type: [String],
    description: 'Imágenes de ejemplo (URLs/claves) que guían al proveedor real. Máx 5.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  sampleImages?: string[];
}

/** Banner generado por IA y registrado como media `cover` del evento. */
export class BannerResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Id del media creado' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ description: 'Clave del objeto en el bucket' })
  key!: string;

  @ApiProperty({ enum: MediaKind })
  kind!: MediaKind;

  @ApiProperty({ description: 'URL firmada del banner' })
  url!: string;

  @ApiProperty({ example: 'stub', description: 'Proveedor que generó el banner' })
  provider!: string;
}
