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

  @ApiProperty({ type: OrderItemResponseDto, isArray: true })
  items!: OrderItemResponseDto[];
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
