import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** Payload de webhook de la pasarela. */
export class WebhookDto {
  @ApiProperty({ description: 'ID del evento en la pasarela (idempotencia)' })
  @IsString()
  @MaxLength(128)
  id!: string;

  @ApiProperty({ enum: ['payment.succeeded', 'payment.failed'] })
  @IsIn(['payment.succeeded', 'payment.failed'])
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
