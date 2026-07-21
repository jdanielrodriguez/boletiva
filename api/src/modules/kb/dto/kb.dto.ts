import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContentStatus, KbVisibility, SupportCategory } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Crea un artículo del KB (admin/asesor). El slug se deriva de la pregunta si falta. */
export class CreateKbArticleDto {
  @ApiProperty({ description: 'Pregunta/título', maxLength: 300 })
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  question!: string;

  @ApiProperty({ description: 'Respuesta con formato (HTML enriquecido; se sanea en el servidor)' })
  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  answerHtml!: string;

  @ApiPropertyOptional({ description: 'Slug único (se autogenera desde la pregunta si se omite)', maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  slug?: string;

  @ApiPropertyOptional({ enum: SupportCategory })
  @IsOptional()
  @IsEnum(SupportCategory)
  category?: SupportCategory;

  @ApiPropertyOptional({ description: 'Idioma (es/en)', default: 'es' })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  locale?: string;

  @ApiPropertyOptional({ enum: KbVisibility, default: 'public' })
  @IsOptional()
  @IsEnum(KbVisibility)
  visibility?: KbVisibility;

  @ApiPropertyOptional({ type: [String], description: 'Etiquetas (máx 20)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Orden dentro de su categoría (asc)', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/** Actualiza un artículo del KB (todos los campos opcionales). */
export class UpdateKbArticleDto {
  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  question?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  answerHtml?: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  slug?: string;

  @ApiPropertyOptional({ enum: SupportCategory, nullable: true })
  @IsOptional()
  @IsEnum(SupportCategory)
  category?: SupportCategory | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5)
  locale?: string;

  @ApiPropertyOptional({ enum: KbVisibility })
  @IsOptional()
  @IsEnum(KbVisibility)
  visibility?: KbVisibility;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/** Filtros del listado público del FAQ. */
export class KbListQueryDto {
  @ApiPropertyOptional({ enum: SupportCategory })
  @IsOptional()
  @IsEnum(SupportCategory)
  category?: SupportCategory;

  @ApiPropertyOptional({ description: 'Idioma (es/en)' })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  locale?: string;

  @ApiPropertyOptional({ description: 'Búsqueda por texto (pregunta/respuesta/etiquetas)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

/** Búsqueda para el bot/autoresponder y el buscador del FAQ. */
export class KbSearchQueryDto {
  @ApiProperty({ description: 'Consulta del usuario' })
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  q!: string;

  @ApiPropertyOptional({ description: 'Idioma (es/en)' })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  locale?: string;

  @ApiPropertyOptional({ description: 'Máximo de resultados (1..10)', default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

// ---- Respuestas (doc OpenAPI) ----

export class KbArticleResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() question!: string;
  @ApiProperty({ description: 'Respuesta con formato (HTML saneado)' }) answerHtml!: string;
  @ApiProperty({ enum: SupportCategory, nullable: true }) category!: SupportCategory | null;
  @ApiProperty() locale!: string;
  @ApiProperty({ enum: ContentStatus }) status!: ContentStatus;
  @ApiProperty({ enum: KbVisibility }) visibility!: KbVisibility;
  @ApiProperty({ type: [String] }) tags!: string[];
  @ApiProperty() sortOrder!: number;
  @ApiProperty() viewCount!: number;
  @ApiProperty({ nullable: true }) publishedAt!: string | null;
  @ApiProperty() updatedAt!: string;
}

/** Vista pública (FAQ): sin campos de gestión. */
export class KbPublicArticleDto {
  @ApiProperty() slug!: string;
  @ApiProperty() question!: string;
  @ApiProperty() answerHtml!: string;
  @ApiProperty({ enum: SupportCategory, nullable: true }) category!: SupportCategory | null;
  @ApiProperty({ type: [String] }) tags!: string[];
}

/** Resultado del autoresponder (texto plano + score, listo para el bot/RAG). */
export class KbSuggestionDto {
  @ApiProperty() slug!: string;
  @ApiProperty() question!: string;
  @ApiProperty({ description: 'Respuesta en texto plano (para el bot/RAG)' }) answerText!: string;
  @ApiProperty({ description: 'Relevancia 0..1' }) score!: number;
}
