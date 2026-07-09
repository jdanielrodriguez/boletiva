import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Marcas de tarjeta soportadas para mostrar (no sensible). */
export const CARD_BRANDS = ['visa', 'mastercard', 'amex', 'discover', 'other'] as const;

/**
 * Alta de un método de pago. PCI-DSS: el cuerpo NO contiene el PAN. El SDK de la
 * pasarela (o el stub del front) captura la tarjeta y entrega un `nonce` de un
 * solo uso + la marca y los últimos 4 dígitos (no sensibles) para mostrar.
 */
export class AddPaymentMethodDto {
  @ApiProperty({ description: 'Nonce de un solo uso del SDK de la pasarela (NO es el PAN)' })
  @IsString()
  @MinLength(6)
  @MaxLength(512)
  nonce!: string;

  @ApiProperty({ enum: CARD_BRANDS, example: 'visa' })
  @IsIn(CARD_BRANDS)
  brand!: string;

  @ApiProperty({ description: 'Últimos 4 dígitos (para mostrar)', example: '4242' })
  @Matches(/^\d{4}$/, { message: 'last4 debe ser exactamente 4 dígitos' })
  last4!: string;

  @ApiPropertyOptional({ description: 'Marcar como método por defecto', example: true })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/** Método de pago guardado (vista segura: sin token ni PAN). */
export class PaymentMethodResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'visa' })
  brand!: string;

  @ApiProperty({ example: '4242' })
  last4!: string;

  @ApiProperty({ example: true })
  isDefault!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
