import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
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

export class CheckinItemDto {
  @ApiProperty({ description: 'Serial del boleto validado en puerta' })
  @IsString()
  @MaxLength(40)
  serial!: string;

  @ApiPropertyOptional({ description: 'Momento del check-in offline (ISO)' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  checkedInAt?: string;

  @ApiPropertyOptional({ description: 'Identificador de la puerta' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  gateId?: string;
}

export class BatchCheckinDto {
  @ApiProperty({ type: [CheckinItemDto], description: 'Lote de check-ins offline' })
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => CheckinItemDto)
  items!: CheckinItemDto[];

  @ApiPropertyOptional({ description: 'Puerta por defecto para todo el lote' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  gateId?: string;
}
