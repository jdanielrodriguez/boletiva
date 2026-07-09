import { ApiProperty } from '@nestjs/swagger';
import { MediaKind } from '@prisma/client';

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
