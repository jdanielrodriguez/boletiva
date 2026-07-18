import { ApiProperty } from '@nestjs/swagger';
import { SalesPointDto } from '../../orders/dto/orders.dto';

/**
 * KPIs globales del promotor (todas sus dimensiones sumadas). Los montos son
 * server-authoritative: se agregan del snapshot inmutable de las órdenes en
 * estado TERMINAL (pagadas / reembolsadas) con `decimal.js`; el frontend NO
 * hace aritmética de dinero.
 */
export class PromoterSummaryDto {
  @ApiProperty({ example: 42, description: 'Órdenes pagadas (todos los eventos)' })
  paidOrders!: number;

  @ApiProperty({ example: 1280, description: 'Boletos vendidos (ítems activos pagados)' })
  ticketsSold!: number;

  @ApiProperty({ type: String, example: '166080.00', description: 'Recaudado bruto' })
  gross!: string;

  @ApiProperty({ type: String, example: '128000.00', description: 'Neto del promotor' })
  net!: string;

  @ApiProperty({
    type: String,
    example: '28000.00',
    description: 'Cuota de servicio (plataforma + pasarela + fijos, sin IVA)',
  })
  services!: string;

  @ApiProperty({ type: String, example: '12000.00', description: 'Comisión de plataforma' })
  platformFee!: string;

  @ApiProperty({ type: String, example: '9000.00', description: 'Comisión de pasarela' })
  gatewayFee!: string;

  @ApiProperty({ type: String, example: '7000.00', description: 'Cargos fijos' })
  fixedFees!: string;

  @ApiProperty({ type: String, example: '15360.00', description: 'IVA recaudado' })
  iva!: string;

  @ApiProperty({ example: 3, description: 'Órdenes reembolsadas' })
  refundsCount!: number;

  @ApiProperty({
    type: String,
    example: '3000.00',
    description: 'Neto devuelto a compradores (órdenes reembolsadas)',
  })
  refundsIssued!: string;

  @ApiProperty({ example: 1500, description: 'Aforo total de los eventos' })
  capacity!: number;

  @ApiProperty({ example: 640, description: 'Boletos con check-in (usados)' })
  checkedIn!: number;

  @ApiProperty({ example: 85.3, description: 'Ocupación % (vendidos / aforo)' })
  occupancyPct!: number;
}

/**
 * Una fila de la tabla cruzada dimensión × métricas. Todos los montos ya vienen
 * agregados y redondeados del backend; el frontend solo los presenta.
 */
export class PromoterDimensionRowDto {
  @ApiProperty({ example: 'cat_uuid', description: 'Clave del grupo (id, estado, mes…)' })
  key!: string;

  @ApiProperty({ example: 'Conciertos', description: 'Etiqueta legible del grupo' })
  label!: string;

  @ApiProperty({ example: 3, description: 'Eventos en el grupo' })
  events!: number;

  @ApiProperty({ example: 420, description: 'Boletos vendidos' })
  ticketsSold!: number;

  @ApiProperty({ type: String, example: '54460.00' })
  gross!: string;

  @ApiProperty({ type: String, example: '42000.00' })
  net!: string;

  @ApiProperty({ type: String, example: '9200.00' })
  services!: string;

  @ApiProperty({ type: String, example: '5040.00' })
  iva!: string;

  @ApiProperty({ type: String, example: '1000.00', description: 'Devoluciones (neto)' })
  refunds!: string;

  @ApiProperty({ example: 500, description: 'Aforo del grupo' })
  capacity!: number;

  @ApiProperty({ example: 84, description: 'Boletos con check-in' })
  checkedIn!: number;

  @ApiProperty({ example: 84.0, description: 'Ocupación % del grupo' })
  occupancyPct!: number;
}

/** Las cinco dimensiones de la tabla cruzada, cada una ya agregada en el backend. */
export class PromoterDimensionsDto {
  @ApiProperty({ type: [PromoterDimensionRowDto], description: 'Por evento' })
  event!: PromoterDimensionRowDto[];

  @ApiProperty({ type: [PromoterDimensionRowDto], description: 'Por categoría' })
  category!: PromoterDimensionRowDto[];

  @ApiProperty({ type: [PromoterDimensionRowDto], description: 'Por salón' })
  hall!: PromoterDimensionRowDto[];

  @ApiProperty({ type: [PromoterDimensionRowDto], description: 'Por estado del evento' })
  status!: PromoterDimensionRowDto[];

  @ApiProperty({ type: [PromoterDimensionRowDto], description: 'Por mes (YYYY-MM de inicio)' })
  month!: PromoterDimensionRowDto[];
}

/** Dashboard GLOBAL del promotor: KPIs + ventas/día + tabla cruzada por dimensión. */
/** Referencia mínima de evento para el selector del dashboard. */
export class DashboardEventRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Concierto de Aniversario' })
  name!: string;
}

export class PromoterDashboardDto {
  @ApiProperty({ format: 'uuid' })
  promoterId!: string;

  @ApiProperty({ example: 'Promotora Central' })
  promoterName!: string;

  @ApiProperty({ example: 'GTQ' })
  currency!: string;

  @ApiProperty({ example: 8, description: 'Total de eventos del promotor' })
  eventsCount!: number;

  @ApiProperty({ example: 6, description: 'Eventos publicados' })
  publishedCount!: number;

  @ApiProperty({ type: PromoterSummaryDto })
  summary!: PromoterSummaryDto;

  @ApiProperty({ type: [SalesPointDto], description: 'Ventas por día (todos los eventos)' })
  salesOverTime!: SalesPointDto[];

  @ApiProperty({ type: PromoterDimensionsDto })
  dimensions!: PromoterDimensionsDto;

  @ApiProperty({ type: [DashboardEventRefDto], description: 'Todos los eventos del promotor (para el selector)' })
  availableEvents!: DashboardEventRefDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Evento al que está filtrado el dashboard (null = todos)',
  })
  selectedEventId!: string | null;
}
