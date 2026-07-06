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
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  filename!: string;

  @IsString()
  @Matches(/^(image|video)\//, { message: 'contentType debe ser image/* o video/*' })
  contentType!: string;
}

export class RegisterMediaDto {
  @IsString()
  @MinLength(1)
  @MaxLength(400)
  key!: string;

  @IsOptional()
  @IsEnum(MediaKind)
  kind?: MediaKind;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
