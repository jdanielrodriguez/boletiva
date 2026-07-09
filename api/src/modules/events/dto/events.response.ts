import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EventStatus, LocalityKind, MediaKind, SeatStatus } from '@prisma/client';

/**
 * DTOs de respuesta del módulo de eventos. SOLO documentación (OpenAPI/SDK):
 * no cambian el comportamiento en runtime. Modelan fielmente lo que devuelve
 * `EventsService` (formas de Prisma).
 */

/** Categoría anidada (relación `category`). */
export class EventCategoryDto {
  @ApiProperty({ format: 'uuid', example: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' })
  id!: string;

  @ApiProperty({ example: 'Conciertos' })
  name!: string;

  @ApiProperty({ example: 'conciertos' })
  slug!: string;

  @ApiPropertyOptional({ nullable: true, example: 'Eventos musicales en vivo' })
  description!: string | null;

  @ApiProperty({ example: true, description: 'Si la categoría está activa' })
  active!: boolean;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Usuario que creó la categoría (null si fue borrado)',
  })
  createdById!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-07-01T18:30:00.000Z' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-07-01T18:30:00.000Z' })
  updatedAt!: string;
}

/** Archivo multimedia anidado (relación `media`, forma completa de EventMedia). */
export class EventMediaItemDto {
  @ApiProperty({ format: 'uuid', example: '9f8b1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' })
  eventId!: string;

  @ApiProperty({
    example: 'events/3f2504e0/9f8b1c2d-poster.jpg',
    description: 'Clave del objeto en el bucket de storage',
  })
  key!: string;

  @ApiProperty({ enum: MediaKind, example: MediaKind.cover })
  kind!: MediaKind;

  @ApiProperty({ example: 0, description: 'Orden de despliegue' })
  position!: number;

  @ApiPropertyOptional({
    type: String,
    description:
      'URL firmada para mostrar el archivo (presente en listados/detalle públicos; ausente en el detalle gestionable)',
    example: 'https://cdn.pasaeventos.com/events/3f2504e0/9f8b1c2d-poster.jpg?X-Amz-Signature=...',
  })
  url?: string;

  @ApiProperty({ format: 'date-time', example: '2026-07-01T18:30:00.000Z' })
  createdAt!: string;
}

/** Localidad anidada (relación `localities`). */
export class EventLocalityDto {
  @ApiProperty({ format: 'uuid', example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' })
  eventId!: string;

  @ApiProperty({ example: 'General' })
  name!: string;

  @ApiProperty({ example: 'general' })
  slug!: string;

  @ApiProperty({ enum: LocalityKind, example: LocalityKind.general })
  kind!: LocalityKind;

  @ApiProperty({ example: 500, description: 'Aforo de la localidad' })
  capacity!: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '100.00',
    description: 'Ganancia neta deseada por el promotor (Decimal como string)',
  })
  desiredNet!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-07-01T18:30:00.000Z' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-07-01T18:30:00.000Z' })
  updatedAt!: string;
}

/** Evento (campos escalares). Base de create/update/publish/cancel. */
export class EventResponseDto {
  @ApiProperty({ format: 'uuid', example: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'Promotor dueño del evento' })
  promoterId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Categoría del evento' })
  categoryId!: string | null;

  @ApiProperty({ example: 'Concierto de Apertura' })
  name!: string;

  @ApiProperty({ example: 'concierto-de-apertura', description: 'Slug único' })
  slug!: string;

  @ApiPropertyOptional({ nullable: true, example: 'Una noche inolvidable' })
  description!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Estadio Nacional, Ciudad de Guatemala' })
  address!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 14.6349, description: 'Latitud' })
  lat!: number | null;

  @ApiPropertyOptional({ nullable: true, example: -90.5069, description: 'Longitud' })
  lng!: number | null;

  @ApiProperty({ format: 'date-time', example: '2026-08-15T02:00:00.000Z' })
  startsAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-08-15T05:00:00.000Z' })
  endsAt!: string;

  @ApiProperty({ enum: EventStatus, example: EventStatus.draft })
  status!: EventStatus;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Pasarela elegida por el promotor (null = hereda la default de plataforma)',
  })
  gatewayId!: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Pasarela congelada al recibir la primera compra (el precio ya no cambia)',
  })
  frozenGatewayId!: string | null;

  @ApiProperty({
    example: true,
    description: 'Si el IVA se aplica sobre el neto del promotor (false = solo sobre comisión de plataforma)',
  })
  ivaOnNet!: boolean;

  @ApiProperty({
    example: false,
    description: 'Si el PROMOTOR absorbe el costo de las cuotas (se descuenta de su neto)',
  })
  absorbInstallmentCost!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    example: 1,
    description: 'Máximo de transferencias por boleto (null = usa el default global)',
  })
  maxTransfers!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 1,
    description: 'Prioridad en el slider de destacados (menor = primero; null = no promocionado)',
  })
  promotedPriority!: number | null;

  @ApiProperty({ format: 'date-time', example: '2026-07-01T18:30:00.000Z' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-07-01T18:30:00.000Z' })
  updatedAt!: string;
}

/** Detalle público por slug: evento + categoría + media + localidades. */
export class PublicEventDetailDto extends EventResponseDto {
  @ApiPropertyOptional({ type: () => EventCategoryDto, nullable: true })
  category!: EventCategoryDto | null;

  @ApiProperty({ type: () => EventMediaItemDto, isArray: true })
  media!: EventMediaItemDto[];

  @ApiProperty({ type: () => EventLocalityDto, isArray: true })
  localities!: EventLocalityDto[];
}

/** Detalle gestionable (owner/admin): mismas relaciones que el público por slug. */
export class ManagedEventDetailDto extends EventResponseDto {
  @ApiPropertyOptional({ type: () => EventCategoryDto, nullable: true })
  category!: EventCategoryDto | null;

  @ApiProperty({ type: () => EventMediaItemDto, isArray: true })
  media!: EventMediaItemDto[];

  @ApiProperty({ type: () => EventLocalityDto, isArray: true })
  localities!: EventLocalityDto[];
}

/** Ítem del listado público: evento + categoría + media. */
export class PublicEventListItemDto extends EventResponseDto {
  @ApiPropertyOptional({ type: () => EventCategoryDto, nullable: true })
  category!: EventCategoryDto | null;

  @ApiProperty({ type: () => EventMediaItemDto, isArray: true })
  media!: EventMediaItemDto[];
}

/** Respuesta del listado público paginado por offset. */
export class PublicEventListDto {
  @ApiProperty({ type: () => PublicEventListItemDto, isArray: true })
  items!: PublicEventListItemDto[];

  @ApiProperty({ example: 42, description: 'Total de eventos que cumplen el filtro' })
  total!: number;

  @ApiProperty({ example: 0, description: 'Offset aplicado' })
  skip!: number;

  @ApiProperty({ example: 20, description: 'Tamaño de página aplicado' })
  take!: number;
}

/** Conteo de relaciones incluido en el listado del promotor. */
export class EventCountDto {
  @ApiProperty({ example: 3, description: 'Cantidad de localidades del evento' })
  localities!: number;
}

/** Ítem del listado del promotor: evento + categoría + _count. */
export class MyEventListItemDto extends EventResponseDto {
  @ApiPropertyOptional({ type: () => EventCategoryDto, nullable: true })
  category!: EventCategoryDto | null;

  @ApiProperty({ type: () => EventCountDto })
  _count!: EventCountDto;
}

/** Promotor resumido en el listado admin de eventos. */
export class AdminEventPromoterDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Ana' })
  firstName!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Pérez' })
  lastName!: string | null;

  @ApiProperty({ example: 'promotor@pasaeventos.com' })
  email!: string;
}

/** Ítem del listado admin: evento + categoría + _count + promotor. */
export class AdminEventListItemDto extends MyEventListItemDto {
  @ApiProperty({ type: () => AdminEventPromoterDto })
  promoter!: AdminEventPromoterDto;
}

// --- Disponibilidad pública para la compra (F2) ---

/** Precio all-in que ve el COMPRADOR (plataforma+pasarela fusionadas en serviceFee). */
export class BuyerPriceDto {
  @ApiProperty({ example: 'GTQ' })
  currency!: string;

  @ApiProperty({ type: String, example: '100.00', description: 'Neto del promotor' })
  net!: string;

  @ApiProperty({
    type: String,
    example: '16.48',
    description: 'Cuota por servicio (plataforma + pasarela fusionadas)',
  })
  serviceFee!: string;

  @ApiProperty({ type: String, example: '13.20', description: 'IVA (12% de la base gravable)' })
  iva!: string;

  @ApiProperty({ type: String, example: '129.68', description: 'Precio final all-in' })
  total!: string;
}

/** Localidad con disponibilidad y precio de comprador. */
export class LocalityAvailabilityDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'General' })
  name!: string;

  @ApiProperty({ example: 'general' })
  slug!: string;

  @ApiProperty({ enum: LocalityKind, example: LocalityKind.general })
  kind!: LocalityKind;

  @ApiProperty({ example: 500, description: 'Aforo total' })
  capacity!: number;

  @ApiProperty({ example: 342, description: 'Cupos disponibles' })
  available!: number;

  @ApiPropertyOptional({
    type: () => BuyerPriceDto,
    nullable: true,
    description: 'Precio del comprador (null si la localidad no tiene neto definido)',
  })
  price!: BuyerPriceDto | null;
}

/** Asiento con coordenadas para el mapa (solo localidades con geometría). */
export class SeatAvailabilityDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  localityId!: string;

  @ApiProperty({ example: 'A-12' })
  label!: string;

  @ApiPropertyOptional({ nullable: true, example: 'Platea' })
  section!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'A' })
  row!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 120.5, description: 'Coordenada X en el mapa' })
  x!: number | null;

  @ApiPropertyOptional({ nullable: true, example: 88.0, description: 'Coordenada Y en el mapa' })
  y!: number | null;

  @ApiProperty({ enum: SeatStatus, example: SeatStatus.available })
  status!: SeatStatus;
}

/** Mapa de asientos activo (geometría del lienzo). */
export class SeatMapDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ example: 1 })
  version!: number;

  @ApiPropertyOptional({ nullable: true, example: 'Planta baja' })
  name!: string | null;

  @ApiProperty({ example: 1000 })
  width!: number;

  @ApiProperty({ example: 800 })
  height!: number;

  @ApiPropertyOptional({ nullable: true, description: 'Fondo del lienzo (imagen/color), JSON libre' })
  background!: Record<string, unknown> | null;

  @ApiProperty({ description: 'Layout libre (secciones/etiquetas), JSON', example: {} })
  layout!: Record<string, unknown>;

  @ApiProperty({ example: true })
  active!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

/** Disponibilidad pública del evento: mapa + localidades (con precio) + asientos. */
export class EventAvailabilityDto {
  @ApiPropertyOptional({ type: () => SeatMapDto, nullable: true })
  seatMap!: SeatMapDto | null;

  @ApiProperty({ type: () => LocalityAvailabilityDto, isArray: true })
  localities!: LocalityAvailabilityDto[];

  @ApiProperty({ type: () => SeatAvailabilityDto, isArray: true })
  seats!: SeatAvailabilityDto[];
}
