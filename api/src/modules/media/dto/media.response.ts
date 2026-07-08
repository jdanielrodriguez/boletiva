import { ApiProperty } from '@nestjs/swagger';
import { MediaKind } from '@prisma/client';

/**
 * DTOs de respuesta del módulo de media. SOLO documentación: modelan fielmente
 * lo que devuelve `MediaService`.
 */

/** Respuesta del presign de subida directa navegador→storage. */
export class PresignUploadResponseDto {
  @ApiProperty({
    example: 'events/3f2504e0/9f8b1c2d-poster.jpg',
    description: 'Clave del objeto en el bucket (úsala luego para registrar el media)',
  })
  key!: string;

  @ApiProperty({
    example: 'https://storage.local/pasaeventos-local/events/...?X-Amz-Signature=...',
    description: 'URL firmada PUT para subir el archivo (expiración corta)',
  })
  uploadUrl!: string;
}

/** Archivo multimedia registrado (forma completa de EventMedia). */
export class MediaResponseDto {
  @ApiProperty({ format: 'uuid', example: '9f8b1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' })
  eventId!: string;

  @ApiProperty({
    example: 'events/3f2504e0/9f8b1c2d-poster.jpg',
    description: 'Clave del objeto en el bucket de storage',
  })
  key!: string;

  @ApiProperty({ enum: MediaKind, example: MediaKind.gallery })
  kind!: MediaKind;

  @ApiProperty({ example: 0, description: 'Orden de despliegue' })
  position!: number;

  @ApiProperty({ format: 'date-time', example: '2026-07-01T18:30:00.000Z' })
  createdAt!: string;
}

/** Ítem del listado público de media: incluye URL firmada de descarga. */
export class PublicMediaItemDto {
  @ApiProperty({ format: 'uuid', example: '9f8b1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d' })
  id!: string;

  @ApiProperty({ enum: MediaKind, example: MediaKind.cover })
  kind!: MediaKind;

  @ApiProperty({ example: 0, description: 'Orden de despliegue' })
  position!: number;

  @ApiProperty({
    example: 'https://storage.local/pasaeventos-local/events/...?X-Amz-Signature=...',
    description: 'URL firmada GET de descarga (expira en 900 s)',
  })
  url!: string;
}
