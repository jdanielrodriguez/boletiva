import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { WalletPlatform } from '../wallet/wallet-provider';

export class VerifyTicketDto {
  @ApiProperty({ description: 'Valor leído del QR (PE1.<serial>.<code>)' })
  @IsString()
  @MaxLength(200)
  payload!: string;

  @ApiPropertyOptional({ description: 'Marca el boleto como usado (check-in)', default: true })
  @IsOptional()
  @IsBoolean()
  checkIn?: boolean;
}

export class CreateWalletPassDto {
  @ApiProperty({ enum: ['google', 'apple'] })
  @IsIn(['google', 'apple'])
  platform!: WalletPlatform;
}

export class ClaimTransferDto {
  @ApiProperty({ description: 'Código de transferencia compartido por el remitente' })
  @IsString()
  @MaxLength(40)
  code!: string;
}
