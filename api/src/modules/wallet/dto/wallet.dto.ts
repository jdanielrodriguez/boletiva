import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class RequestWithdrawalDto {
  @ApiProperty({ description: 'Monto bruto a retirar del saldo (GTQ)', example: 100 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  amount!: number;
}

export class WithdrawalDecisionDto {
  @ApiPropertyOptional({ description: 'Motivo de rechazo o referencia de pago' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
