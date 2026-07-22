import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Tarjeta capturada en NUESTRO formulario (pasarelas sin SDK de tokenización, p.ej. Pagalo).
 * Viaja por TLS; el backend la cifra en reposo (vault reversible) para cobrar. El CVV NUNCA
 * se persiste (PCI): se exige fresco en cada cobro.
 */
export class CardDto {
  @ApiProperty({ description: 'Número de tarjeta (PAN), sólo dígitos', example: '4242424242424242' })
  @IsString()
  @Matches(/^\d{13,19}$/, { message: 'number debe tener 13-19 dígitos' })
  number!: string;

  @ApiProperty({ description: 'Mes de expiración MM', example: '12' })
  @IsString()
  @Matches(/^(0[1-9]|1[0-2])$/, { message: 'expMonth debe ser MM (01-12)' })
  expMonth!: string;

  @ApiProperty({ description: 'Año de expiración YYYY', example: '2030' })
  @IsString()
  @Matches(/^20\d{2}$/, { message: 'expYear debe ser YYYY' })
  expYear!: string;

  @ApiProperty({ description: 'CVV (3-4 dígitos). No se almacena.', example: '123' })
  @IsString()
  @Matches(/^\d{3,4}$/, { message: 'cvv debe tener 3-4 dígitos' })
  cvv!: string;

  @ApiProperty({ description: 'Nombre en la tarjeta', example: 'JUAN PEREZ' })
  @IsString()
  @MaxLength(150)
  name!: string;
}

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

  @ApiPropertyOptional({
    type: CardDto,
    description:
      'Tarjeta capturada en nuestro formulario. Requerida SOLO para pasarelas sin SDK de ' +
      'tokenización (Pagalo) cuando no se paga todo con wallet. Simulador/Recurrente la ignoran.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CardDto)
  card?: CardDto;
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
    description: 'true = pasarela en MODO PRUEBA (sandbox): no genera cargos reales. El checkout muestra un aviso.',
    example: true,
  })
  sandbox!: boolean;

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
