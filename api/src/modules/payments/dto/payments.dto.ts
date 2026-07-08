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
