import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Forma de una categoría tal como la retorna `CategoriesService` (registro
 * completo del modelo `Category`). Solo documentación para el OpenAPI/SDK;
 * no altera el runtime.
 */
export class CategoryResponseDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'Identificador de la categoría',
    example: '9c1e6f2a-1b7d-4d3e-8b2a-1f0e2d3c4b5a',
  })
  id!: string;

  @ApiProperty({ description: 'Nombre de la categoría', example: 'Conciertos' })
  name!: string;

  @ApiProperty({
    description: 'Slug único derivado del nombre',
    example: 'conciertos',
  })
  slug!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Descripción de la categoría',
    example: 'Eventos de música en vivo',
  })
  description!: string | null;

  @ApiProperty({ description: 'Indica si la categoría está activa', example: true })
  active!: boolean;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Id del usuario que la creó (null si el creador fue eliminado)',
    example: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  })
  createdById!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Fecha de creación',
    example: '2026-07-01T09:00:00.000Z',
  })
  createdAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Fecha de última actualización',
    example: '2026-07-05T10:15:00.000Z',
  })
  updatedAt!: string;
}
