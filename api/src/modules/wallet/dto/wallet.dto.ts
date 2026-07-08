import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WithdrawalStatus } from '@prisma/client';
import { IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

/** Query admin de retiros: paginación keyset + filtro por estado. */
export class WithdrawalsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: WithdrawalStatus })
  @IsOptional()
  @IsEnum(WithdrawalStatus)
  status?: WithdrawalStatus;
}

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
