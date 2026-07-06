import { LocalityKind } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateLocalityDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsEnum(LocalityKind)
  kind?: LocalityKind;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  capacity?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  desiredNet?: number;
}

export class UpdateLocalityDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEnum(LocalityKind)
  kind?: LocalityKind;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  capacity?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  desiredNet?: number;
}

export class SeatInputDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  section?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  row?: string;

  @IsOptional()
  @IsNumber()
  x?: number;

  @IsOptional()
  @IsNumber()
  y?: number;
}

export class BulkSeatsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => SeatInputDto)
  seats!: SeatInputDto[];
}

export class GenerateSeatsDto {
  @IsInt()
  @Min(1)
  @Max(5000)
  count!: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  labelPrefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  section?: string;
}

export class DeleteSeatsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  ids!: string[];
}

export class CreateSeatMapDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;

  @IsOptional()
  @IsObject()
  background?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  layout?: Record<string, unknown>;
}
