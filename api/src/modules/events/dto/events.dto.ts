import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Descripción compartida del destacado editable (slider del inicio). */
const PROMOTED_DESC =
  'Prioridad en el slider de destacados del inicio (menor = primero). ' +
  'null/omitir = no promocionado. Lo edita admin/promotor.';

/** Descripción compartida del flag de absorción de cuotas (transparencia frontend). */
const ABSORB_DESC =
  'Si el PROMOTOR absorbe el costo de las cuotas (se descuenta de su neto). ' +
  'false/omitir = lo absorbe la PLATAFORMA. El comprador paga igual en ambos casos.';

export class CreateEventDto {
  @ApiProperty({ description: 'Nombre del evento (3–150 caracteres)', example: 'Concierto de Apertura' })
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional({ description: 'Descripción larga (máx 5000)', example: 'Una noche inolvidable' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Categoría del evento' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Salón/venue reutilizable. Si se indica, prefija address/lat/lng vacíos.',
  })
  @IsOptional()
  @IsUUID()
  hallId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Promotor dueño del evento. SOLO tiene efecto si el caller es ADMIN (crea el ' +
      'evento a nombre de ese promotor, que debe estar APROBADO). Un promotor no-admin ' +
      'lo ignora y crea el evento a su propio nombre.',
  })
  @IsOptional()
  @IsUUID()
  promoterId?: string;

  @ApiPropertyOptional({ description: 'Dirección/lugar (máx 300)', example: 'Estadio Nacional, Ciudad de Guatemala' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional({ description: 'Latitud', example: 14.6349 })
  @IsOptional()
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ description: 'Longitud', example: -90.5069 })
  @IsOptional()
  @IsLongitude()
  lng?: number;

  @ApiProperty({ format: 'date-time', description: 'Inicio del evento (ISO 8601)', example: '2026-08-15T02:00:00.000Z' })
  @IsDateString()
  startsAt!: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'Fin del evento (ISO 8601, posterior a startsAt). Opcional: si se omite, el backend usa startsAt + 12h.',
    example: '2026-08-15T05:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Pasarela elegida por el promotor (omitir = hereda la default de plataforma)',
  })
  @IsOptional()
  @IsUUID()
  gatewayId?: string;

  @ApiPropertyOptional({
    default: true,
    description: 'Si el IVA se aplica sobre el neto del promotor (false = solo sobre comisión de plataforma)',
  })
  @IsOptional()
  @IsBoolean()
  ivaOnNet?: boolean;

  @ApiPropertyOptional({ description: ABSORB_DESC, default: false })
  @IsOptional()
  @IsBoolean()
  absorbInstallmentCost?: boolean;

  @ApiPropertyOptional({ description: PROMOTED_DESC, example: 1, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  promotedPriority?: number;
}

export class UpdateEventDto {
  @ApiPropertyOptional({ description: 'Nombre del evento (3–150 caracteres)', example: 'Concierto de Apertura' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ description: 'Descripción larga (máx 5000)', example: 'Una noche inolvidable' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Categoría del evento' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Salón/venue reutilizable. Si se indica, prefija address/lat/lng vacíos.',
  })
  @IsOptional()
  @IsUUID()
  hallId?: string;

  @ApiPropertyOptional({ description: 'Dirección/lugar (máx 300)', example: 'Estadio Nacional, Ciudad de Guatemala' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional({ description: 'Latitud', example: 14.6349 })
  @IsOptional()
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ description: 'Longitud', example: -90.5069 })
  @IsOptional()
  @IsLongitude()
  lng?: number;

  @ApiPropertyOptional({ format: 'date-time', description: 'Inicio del evento (ISO 8601)', example: '2026-08-15T02:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional({ format: 'date-time', description: 'Fin del evento (ISO 8601, posterior a startsAt)', example: '2026-08-15T05:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Pasarela elegida por el promotor (bloqueada si el evento ya tiene compras)',
  })
  @IsOptional()
  @IsUUID()
  gatewayId?: string;

  @ApiPropertyOptional({
    default: true,
    description: 'Si el IVA se aplica sobre el neto del promotor (bloqueado si el evento ya tiene compras)',
  })
  @IsOptional()
  @IsBoolean()
  ivaOnNet?: boolean;

  @ApiPropertyOptional({ description: ABSORB_DESC, default: false })
  @IsOptional()
  @IsBoolean()
  absorbInstallmentCost?: boolean;

  @ApiPropertyOptional({ description: PROMOTED_DESC, example: 1, minimum: 0, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  promotedPriority?: number;
}
