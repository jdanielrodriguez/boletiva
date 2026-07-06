import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  occurredAt?: string;
}
