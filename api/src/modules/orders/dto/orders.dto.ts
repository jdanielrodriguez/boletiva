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

  @ApiProperty({
    type: String,
    example: '0.00',
    description:
      'Neto ya devuelto a compradores (órdenes reembolsadas por cancelación/suspensión). ' +
      'Informativo: estas órdenes ya NO cuentan en los montos de arriba (solo agregan las pagadas).',
  })
  refundsIssued!: string;
}

export class EventCashTransferDto {
  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ example: 'Concierto de Apertura' })
  eventName!: string;

  @ApiProperty({ format: 'uuid', description: 'Promotor que recibe el saldo en su wallet' })
  promoterId!: string;

  @ApiProperty({ example: 'GTQ' })
  currency!: string;

  @ApiProperty({
    type: String,
    example: '34200.00',
    description: 'Neto transferido desde promoter_payable al wallet del promotor',
  })
  transferred!: string;

  @ApiProperty({ example: 'finished', description: 'Estado del evento tras el cierre' })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  transferredAt!: string;
}

/** Cuerpo de la devolución por cancelación/suspensión (F1). */
export class EventRefundDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Orden concreta a devolver. Si se omite, se devuelven TODAS las órdenes pagadas del evento.',
  })
  @IsOptional()
  @IsUUID()
  orderId?: string;
}

/** Resultado por orden dentro de la devolución (F1). */
export class RefundedOrderDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ format: 'uuid', description: 'Comprador al que se acreditó el neto' })
  buyerId!: string;

  @ApiProperty({ type: String, example: '100.00', description: 'Neto acreditado a su wallet' })
  net!: string;

  @ApiProperty({ example: 'refunded', description: 'Estado final de la orden' })
  status!: string;
}

/** Respuesta de la devolución por cancelación/suspensión del evento (F1). */
export class EventRefundResultDto {
  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ example: 'GTQ' })
  currency!: string;

  @ApiProperty({ example: 3, description: 'Órdenes efectivamente devueltas en esta llamada' })
  refundedOrders!: number;

  @ApiProperty({
    example: 1,
    description: 'Órdenes omitidas por ya estar devueltas (solo en modo "todas"; idempotencia)',
  })
  skipped!: number;

  @ApiProperty({
    type: String,
    example: '300.00',
    description: 'Suma del neto acreditado a los compradores (el servicio NO se devuelve)',
  })
  totalNetRefunded!: string;

  @ApiProperty({ type: () => RefundedOrderDto, isArray: true })
  orders!: RefundedOrderDto[];
}

/** Un movimiento del feed de facturación (ingreso/egreso). */
export class MovementResponseDto {
  @ApiProperty({ description: 'id sintético estable', example: 'order:8f…' })
  id!: string;

  @ApiProperty({ enum: ['income', 'expense'], example: 'expense' })
  direction!: string;

  @ApiProperty({
    description: 'purchase = compra (egreso); refund/resale/sale = ingreso',
    example: 'purchase',
  })
  kind!: string;

  @ApiProperty({ type: String, description: 'Monto absoluto', example: '129.68' })
  amount!: string;

  @ApiProperty({ example: 'GTQ' })
  currency!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Estado: egresos = estado de la orden; ingresos = refunded/paid',
  })
  status!: string | null;

  @ApiProperty({ type: String, nullable: true })
  eventName!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Orden para abrir su detalle' })
  orderId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

/** Feed unificado de movimientos (ingresos + egresos), más recientes primero. */
export class MovementsResponseDto {
  @ApiProperty({ type: MovementResponseDto, isArray: true })
  items!: MovementResponseDto[];
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

/**
 * Una transacción (orden) del evento para la tabla de Cuentas del panel
 * (promotor dueño / admin): comprador, fecha, estado, total y localidades.
 */
export class EventTransactionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Nombre del comprador' })
  buyerName!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Correo del comprador' })
  buyerEmail!: string | null;

  @ApiProperty({
    description: 'Estado de la orden',
    enum: ['pending', 'paid', 'cancelled', 'expired', 'refunded'],
    example: 'paid',
  })
  status!: string;

  @ApiProperty({ type: String, description: 'Total all-in', example: '129.68' })
  total!: string;

  @ApiProperty({ example: 'GTQ' })
  currency!: string;

  @ApiProperty({ example: 2, description: 'Cantidad de ítems/boletos de la orden' })
  itemCount!: number;

  @ApiProperty({
    type: String,
    isArray: true,
    description: 'Localidades distintas presentes en la orden',
    example: ['VIP', 'General'],
  })
  localities!: string[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

/** Página keyset de transacciones del evento: `{ items, nextCursor }`. */
export class EventTransactionPageDto {
  @ApiProperty({ type: EventTransactionDto, isArray: true })
  items!: EventTransactionDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Cursor para la siguiente página; null si no hay más',
    example: null,
  })
  nextCursor!: string | null;
}
