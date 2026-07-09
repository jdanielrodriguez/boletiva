import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PriceQuoteResponseDto } from '../../pricing/dto/pricing.dto';

export class CheckoutDto {
  @ApiProperty({
    description: 'IDs de los asientos a comprar (previamente reservados)',
    type: [String],
    maxItems: 50,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  seatIds!: string[];

  @ApiPropertyOptional({ description: 'NIT para facturación FEL; vacío = CF (consumidor final)' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  billingNit?: string;

  @ApiPropertyOptional({ description: 'Nombre de facturación FEL' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  billingName?: string;

  @ApiPropertyOptional({ description: 'Dirección de facturación FEL' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  billingAddress?: string;
}

// ---------------------------------------------------------------------------
// Respuestas (solo documentación OpenAPI). Dinero como string (Decimal).
// ---------------------------------------------------------------------------

/** Localidad anidada de una línea de orden (nombre para facturación). */
export class OrderItemLocalityDto {
  @ApiProperty({ example: 'VIP' })
  name!: string;
}

/** Evento anidado en la orden (nombre/slug/fecha para facturación). */
export class OrderEventSummaryDto {
  @ApiProperty({ example: 'Concierto de Apertura' })
  name!: string;

  @ApiProperty({ example: 'concierto-de-apertura' })
  slug!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  startsAt!: string;
}

/** Línea de orden con snapshot inmutable de precio (PriceQuote + hash). */
export class OrderItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ format: 'uuid' })
  localityId!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Asiento (null = admisión general por aforo)',
  })
  seatId!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Etiqueta del asiento' })
  label!: string | null;

  @ApiPropertyOptional({
    description: 'Localidad del ítem (incluida en el detalle de facturación)',
    type: () => OrderItemLocalityDto,
  })
  locality?: OrderItemLocalityDto;

  @ApiProperty({ type: String, description: 'Neto del ítem', example: '100.00' })
  net!: string;

  @ApiProperty({ type: String, description: 'Total all-in del ítem', example: '129.68' })
  total!: string;

  @ApiProperty({ type: PriceQuoteResponseDto, description: 'PriceQuote íntegro (snapshot)' })
  quote!: PriceQuoteResponseDto;

  @ApiProperty({ description: 'Hash anti-manipulación del quote' })
  quoteHash!: string;

  @ApiProperty({ description: 'Ítem activo (false = liberado por reembolso/fallo)', example: true })
  active!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

/** Orden con totales (snapshot), datos FEL y sus líneas. */
export class OrderResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  buyerId!: string;

  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({
    description: 'Estado de la orden',
    enum: ['pending', 'paid', 'cancelled', 'expired', 'refunded'],
    example: 'pending',
  })
  status!: string;

  @ApiProperty({ example: 'GTQ' })
  currency!: string;

  @ApiProperty({ type: String, example: '100.00' })
  net!: string;

  @ApiProperty({ type: String, example: '0.00' })
  fixedFees!: string;

  @ApiProperty({ type: String, example: '10.00' })
  platformFee!: string;

  @ApiProperty({ type: String, example: '110.00' })
  taxableBase!: string;

  @ApiProperty({ type: String, example: '13.20' })
  iva!: string;

  @ApiProperty({ type: String, example: '6.48' })
  gatewayFee!: string;

  @ApiProperty({ type: String, description: 'Total all-in', example: '129.68' })
  total!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  feeScheduleId!: string | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Versión de comisiones usada', example: 1 })
  feeScheduleVersion!: number | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Pasarela usada en la cotización' })
  feeGatewayId!: string | null;

  @ApiProperty({ description: "NIT de facturación ('CF' = consumidor final)", example: 'CF' })
  billingNit!: string;

  @ApiProperty({ type: String, nullable: true })
  billingName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  billingAddress!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'UUID de la factura FEL certificada' })
  felUuid!: string | null;

  @ApiProperty({ type: String, nullable: true })
  felSerie!: string | null;

  @ApiProperty({ type: String, nullable: true })
  felNumero!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  felCertifiedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Vencimiento de la ventana de pago' })
  expiresAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  paidAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelledAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiPropertyOptional({ type: () => OrderEventSummaryDto, description: 'Evento (incluido en el detalle)' })
  event?: OrderEventSummaryDto;

  @ApiProperty({ type: OrderItemResponseDto, isArray: true })
  items!: OrderItemResponseDto[];
}

/** Una transacción de la cadena contable de la orden (vista "blockchain"). */
export class OrderLedgerTxDto {
  @ApiProperty({ description: 'Número de secuencia global (orden en la cadena)', example: '42' })
  seq!: string;

  @ApiProperty({ description: 'Tipo de asiento', example: 'order_payment' })
  kind!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ description: 'Hash SHA-256 de la transacción' })
  hash!: string;

  @ApiProperty({ description: 'Hash de la transacción anterior (encadenado)' })
  prevHash!: string;

  @ApiProperty({ description: 'true si el hash recomputado coincide (no manipulada)', example: true })
  verified!: boolean;
}

/** Cadena contable de una orden + verificación global (transparencia al comprador). */
export class OrderLedgerChainDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ type: OrderLedgerTxDto, isArray: true, description: 'Transacciones encadenadas de la orden' })
  transactions!: OrderLedgerTxDto[];

  @ApiProperty({ description: 'true si toda la cadena del ledger verifica íntegra', example: true })
  chainValid!: boolean;
}

/** Liquidación (cuentas) agregada de un evento sobre sus órdenes pagadas. */
export class EventSettlementDto {
  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ example: 'Concierto de Apertura' })
  eventName!: string;

  @ApiProperty({ example: 'GTQ' })
  currency!: string;

  @ApiProperty({ example: 128, description: 'Cantidad de órdenes pagadas' })
  paidOrders!: number;

  @ApiProperty({ example: 342, description: 'Boletos vendidos (ítems activos de órdenes pagadas)' })
  ticketsSold!: number;

  @ApiProperty({ type: String, example: '44300.16', description: 'Total cobrado (suma de totales)' })
  gross!: string;

  @ApiProperty({ type: String, example: '34200.00', description: 'Neto a liquidar al promotor' })
  net!: string;

  @ApiProperty({ type: String, example: '3420.00', description: 'Comisión de plataforma' })
  platformFee!: string;

  @ApiProperty({ type: String, example: '2214.72', description: 'Comisión de la pasarela' })
  gatewayFee!: string;

  @ApiProperty({ type: String, example: '256.00', description: 'Cargos fijos (p.ej. Q2/transacción)' })
  fixedFees!: string;

  @ApiProperty({
    type: String,
    example: '5890.72',
    description: 'Cuota por servicio (plataforma + pasarela + fijos, sin IVA)',
  })
  serviceFee!: string;

  @ApiProperty({ type: String, example: '4104.00', description: 'IVA recaudado' })
  iva!: string;
}

/** Página keyset de órdenes: `{ items, nextCursor }`. */
export class OrderPageResponseDto {
  @ApiProperty({ type: OrderResponseDto, isArray: true })
  items!: OrderResponseDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Cursor para la siguiente página (id de la última fila); null si no hay más',
    example: null,
  })
  nextCursor!: string | null;
}
