import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MediaKind } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class PresignUploadDto {
  @ApiProperty({ description: 'Nombre del archivo original (1–200)', example: 'poster.jpg' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  filename!: string;

  @ApiProperty({
    description: 'MIME type; debe ser image/* o video/*',
    example: 'image/jpeg',
  })
  @IsString()
  @Matches(/^(image|video)\//, { message: 'contentType debe ser image/* o video/*' })
  contentType!: string;
}

export class RegisterMediaDto {
  @ApiProperty({
    description: 'Clave del objeto ya subido al bucket (la devuelta por el presign)',
    example: 'events/3f2504e0/9f8b1c2d-poster.jpg',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(400)
  key!: string;

  @ApiPropertyOptional({ enum: MediaKind, description: 'Tipo de media (default gallery)', example: MediaKind.cover })
  @IsOptional()
  @IsEnum(MediaKind)
  kind?: MediaKind;

  @ApiPropertyOptional({ minimum: 0, description: 'Orden de despliegue (default 0)', example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
