import { ApiProperty } from '@nestjs/swagger';

/** Rentabilidad de UN evento para la plataforma (server-authoritative, snapshot de órdenes). */
export class AdminProfitabilityRowDto {
  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ example: 'Concierto de Apertura' })
  name!: string;

  @ApiProperty({ example: 'Promotora Central' })
  promoterName!: string;

  @ApiProperty({ example: 'finished' })
  status!: string;

  @ApiProperty({ example: 180, description: 'Boletos vendidos (ítems activos pagados)' })
  ticketsSold!: number;

  @ApiProperty({ type: String, example: '23342.40', description: 'Recaudado bruto' })
  gross!: string;

  @ApiProperty({ type: String, example: '18000.00', description: 'Neto del promotor' })
  net!: string;

  @ApiProperty({ type: String, example: '1800.00', description: 'Ganancia de la plataforma (comisión)' })
  platformFee!: string;

  @ApiProperty({ type: String, example: '1200.00', description: 'Comisión de la pasarela' })
  gatewayFee!: string;

  @ApiProperty({ type: String, example: '2160.00', description: 'IVA recaudado' })
  iva!: string;

  @ApiProperty({
    example: 10,
    description: 'Comisión de plataforma EFECTIVA aplicada = platformFee / net (%). Varía por evento.',
  })
  platformPct!: number;
}

/** Dashboard ADMIN de rentabilidad: totales + una fila por evento, comparables. */
export class AdminProfitabilityDto {
  @ApiProperty({ example: 'GTQ' })
  currency!: string;

  @ApiProperty({ example: 8 })
  eventsCount!: number;

  @ApiProperty({ example: 42 })
  paidOrders!: number;

  @ApiProperty({ example: 1280 })
  ticketsSold!: number;

  @ApiProperty({ type: String, example: '166080.00' })
  gross!: string;

  @ApiProperty({ type: String, example: '128000.00' })
  net!: string;

  @ApiProperty({ type: String, example: '12800.00', description: 'Ganancia total de la plataforma' })
  platformFee!: string;

  @ApiProperty({ type: String, example: '9600.00' })
  gatewayFee!: string;

  @ApiProperty({ type: String, example: '15360.00' })
  iva!: string;

  @ApiProperty({ example: 10, description: 'Comisión de plataforma efectiva global (platformFee/net %).' })
  platformPct!: number;

  @ApiProperty({ type: [AdminProfitabilityRowDto], description: 'Por evento, ordenado por ganancia desc' })
  events!: AdminProfitabilityRowDto[];
}
