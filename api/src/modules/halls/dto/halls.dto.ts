import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateHallDto {
  @ApiProperty({ description: 'Nombre del salón/venue', example: 'Teatro Nacional' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional({ description: 'Dirección', example: '24 Calle 3-81, Zona 1' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional({ description: 'Latitud', example: 14.6407 })
  @IsOptional()
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ description: 'Longitud', example: -90.5133 })
  @IsOptional()
  @IsLongitude()
  lng?: number;

  @ApiPropertyOptional({ description: 'Ciudad', example: 'Ciudad de Guatemala' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ description: 'Notas internas', example: 'Aforo 1200; parqueo propio' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Plantilla de asientos base del salón' })
  @IsOptional()
  @IsUUID()
  seatTemplateId?: string;
}

export class UpdateHallDto {
  @ApiPropertyOptional({ example: 'Teatro Nacional' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ example: '24 Calle 3-81, Zona 1' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional({ example: 14.6407 })
  @IsOptional()
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ example: -90.5133 })
  @IsOptional()
  @IsLongitude()
  lng?: number;

  @ApiPropertyOptional({ example: 'Ciudad de Guatemala' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: 'Aforo 1200; parqueo propio' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  seatTemplateId?: string;
}

export class HallResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Teatro Nacional' })
  name!: string;

  @ApiProperty({ nullable: true, example: '24 Calle 3-81, Zona 1' })
  address!: string | null;

  @ApiProperty({ nullable: true, example: 14.6407 })
  lat!: number | null;

  @ApiProperty({ nullable: true, example: -90.5133 })
  lng!: number | null;

  @ApiProperty({ nullable: true, example: 'Ciudad de Guatemala' })
  city!: string | null;

  @ApiProperty({ nullable: true })
  notes!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  seatTemplateId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
