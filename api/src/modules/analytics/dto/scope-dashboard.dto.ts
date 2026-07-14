import { ApiProperty } from '@nestjs/swagger';
import { SalesPointDto } from '../../orders/dto/orders.dto';

export class ScopeSummaryDto {
  @ApiProperty({ example: 12, description: 'Órdenes pagadas en el alcance' })
  paidOrders!: number;

  @ApiProperty({ example: 340, description: 'Boletos vendidos (ítems activos pagados)' })
  ticketsSold!: number;

  @ApiProperty({ type: String, example: '44300.16', description: 'Total recaudado' })
  gross!: string;

  @ApiProperty({ type: String, example: '34000.00', description: 'Neto de los promotores' })
  net!: string;

  @ApiProperty({ type: String, example: '9500.00', description: 'Servicios (gross − net)' })
  services!: string;

  @ApiProperty({ type: String, example: '4104.00', description: 'IVA recaudado' })
  iva!: string;
}

export class ScopeTopEventDto {
  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ example: 'Concierto de Apertura' })
  name!: string;

  @ApiProperty({ example: 'published' })
  status!: string;

  @ApiProperty({ example: 180, description: 'Boletos vendidos del evento' })
  ticketsSold!: number;

  @ApiProperty({ type: String, example: '23200.00', description: 'Recaudado del evento' })
  gross!: string;
}

export class ScopeOccupancyDto {
  @ApiProperty({ example: 2000 })
  totalCapacity!: number;

  @ApiProperty({ example: 340 })
  totalSold!: number;

  @ApiProperty({ example: 17 })
  occupancyPct!: number;
}

export class ScopeDashboardDto {
  @ApiProperty({ example: 'hall', enum: ['hall', 'template'] })
  scope!: string;

  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Estadio Nacional' })
  name!: string;

  @ApiProperty({ example: 'GTQ' })
  currency!: string;

  @ApiProperty({ example: 8, description: 'Cantidad de eventos vinculados al alcance' })
  eventsCount!: number;

  @ApiProperty({ example: 5, description: 'Eventos publicados' })
  publishedCount!: number;

  @ApiProperty({ type: ScopeSummaryDto })
  summary!: ScopeSummaryDto;

  @ApiProperty({ type: [SalesPointDto], description: 'Ventas por día agregadas del alcance' })
  salesOverTime!: SalesPointDto[];

  @ApiProperty({ type: ScopeOccupancyDto })
  occupancy!: ScopeOccupancyDto;

  @ApiProperty({ type: [ScopeTopEventDto], description: 'Eventos con más recaudación (top 5)' })
  topEvents!: ScopeTopEventDto[];
}
