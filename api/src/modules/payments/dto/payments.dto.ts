import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Cuerpo (opcional) para iniciar el pago de una orden. */
export class PayOrderDto {
  @ApiPropertyOptional({
    description:
      'Método/pasarela elegida (recotiza el total con su comisión); omitir usa la del evento',
  })
  @IsOptional()
  @IsUUID()
  gatewayId?: string;

  @ApiPropertyOptional({
    description: 'Usar el saldo interno primero (pago mixto si no alcanza)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  useWallet?: boolean;

  @ApiPropertyOptional({
    description:
      'Número de cuotas (Recurrente/Visacuotas: 3/6/12/18). Omitir o 1 = pago único. ' +
      'El comprador paga lo mismo; el costo de financiamiento lo absorbe la plataforma ' +
      '(o el promotor si el evento lo marca).',
    minimum: 1,
    maximum: 48,
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(48) // Visacuotas admite hasta 48 meses según el comercio
  installments?: number;

  @ApiPropertyOptional({
    description: 'NIT de facturación (FEL). Se captura en el checkout; default CF (consumidor final).',
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  billingNit?: string;

  @ApiPropertyOptional({ description: 'Nombre fiscal para la factura (FEL).', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  billingName?: string;
}

/** Payload de webhook de la pasarela. */
export class WebhookDto {
  @ApiProperty({ description: 'ID del evento en la pasarela (idempotencia)' })
  @IsString()
  @MaxLength(128)
  id!: string;

  @ApiProperty({
    enum: ['payment.succeeded', 'payment.failed', 'payment.refunded', 'payment.chargeback'],
  })
  @IsIn(['payment.succeeded', 'payment.failed', 'payment.refunded', 'payment.chargeback'])
  type!: string;

  @ApiProperty({ description: 'Referencia del pago en la pasarela' })
  @IsString()
  @MaxLength(128)
  providerRef!: string;

  @ApiPropertyOptional({ description: 'Marca de tiempo del evento en la pasarela (ISO 8601)' })
  @IsOptional()
  @IsString()
  occurredAt?: string;
}

// ---------------------------------------------------------------------------
// Respuestas (solo documentación OpenAPI). Dinero como string (Decimal).
// ---------------------------------------------------------------------------

/** Resultado de iniciar el pago de una orden (intento/estado). */
export class PayOrderResponseDto {
  @ApiProperty({ format: 'uuid', description: 'ID del intento de pago' })
  paymentId!: string;

  @ApiProperty({ description: 'Referencia del pago en la pasarela' })
  providerRef!: string;

  @ApiProperty({
    description: 'Estado del intento de pago',
    enum: ['pending', 'succeeded', 'failed', 'refunded'],
    example: 'pending',
  })
  status!: string;

  @ApiProperty({ description: 'Método de pago', enum: ['gateway', 'wallet', 'mixed'], example: 'gateway' })
  method!: string;

  @ApiProperty({ type: String, description: 'Monto cobrado por la pasarela', example: '129.68' })
  amount!: string;

  @ApiProperty({ type: String, description: 'Monto cubierto con saldo interno', example: '0.00' })
  walletAmount!: string;

  @ApiPropertyOptional({ description: 'Cuotas confirmadas (eco de la selección)', example: 1 })
  installments?: number;

  @ApiPropertyOptional({
    description: 'URL para completar el pago en la pasarela (ausente si el wallet cubre todo)',
  })
  paymentUrl?: string;
}

/** Confirmación de recepción de un webhook (idempotente). */
export class WebhookResponseDto {
  @ApiProperty({ description: 'Webhook recibido', example: true })
  received!: boolean;

  @ApiPropertyOptional({ description: 'true si el evento ya se había procesado (replay)', example: false })
  duplicate?: boolean;

  @ApiPropertyOptional({ description: 'true si no hay un pago asociado a la referencia', example: false })
  unknown?: boolean;
}

/** Un plazo disponible dentro de una pasarela (el comprador paga igual en todos). */
export class InstallmentOptionResponseDto {
  @ApiProperty({ description: 'Número de cuotas (1 = pago único)', example: 1 })
  installments!: number;

  @ApiProperty({ type: String, description: 'Total que paga el comprador', example: '129.68' })
  total!: string;

  @ApiProperty({ type: String, description: 'Cuota por servicio (fusionada) del comprador', example: '16.48' })
  serviceFee!: string;
}

/** Opción de pago por pasarela: total del comprador + plazos disponibles. */
export class GatewayPaymentOptionResponseDto {
  @ApiProperty({ format: 'uuid' })
  gatewayId!: string;

  @ApiProperty({ description: 'Nombre de la pasarela', example: 'Recurrente' })
  name!: string;

  @ApiProperty({ description: 'Proveedor técnico', example: 'recurrente' })
  provider!: string;

  @ApiProperty({ description: 'Si es la pasarela default de plataforma', example: true })
  isPlatformDefault!: boolean;

  @ApiProperty({
    description:
      'true = pasarela EFECTIVA/asignada al evento para esta orden. El frontend debe preseleccionarla en el checkout.',
    example: true,
  })
  recommended!: boolean;

  @ApiProperty({ type: String, description: 'Total en 1 pago (el comprador paga igual)', example: '129.68' })
  total!: string;

  @ApiProperty({ type: String, description: 'Cuota por servicio (fusionada) en 1 pago', example: '16.48' })
  serviceFee!: string;

  @ApiProperty({
    type: InstallmentOptionResponseDto,
    isArray: true,
    description: 'Plazos disponibles (los de margen negativo se ocultan si absorbe la plataforma)',
  })
  installmentOptions!: InstallmentOptionResponseDto[];
}

/** Opciones de pago del checkout de una orden: pasarelas activas + plazos. */
export class PaymentOptionsResponseDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ example: 'GTQ' })
  currency!: string;

  @ApiProperty({
    description: 'true = el promotor absorbe el costo de cuotas (libera todos los plazos)',
    example: false,
  })
  absorbedByPromoter!: boolean;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Pasarela EFECTIVA/asignada al evento (congelada de la orden → congelada del evento → elegida por el promotor → default de plataforma). El frontend preselecciona el gateway cuyo id coincide (o el item con recommended:true). null si no hay ninguna configurada.',
    example: 'a1b2c3d4-0000-0000-0000-000000000000',
  })
  eventGatewayId!: string | null;

  @ApiProperty({ type: GatewayPaymentOptionResponseDto, isArray: true })
  gateways!: GatewayPaymentOptionResponseDto[];
}
