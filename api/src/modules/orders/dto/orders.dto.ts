import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CheckoutDto {
  @ApiProperty({
    description: 'IDs de los asientos a comprar (previamente reservados)',
    type: [String],
    maxItems: 50,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  seatIds!: string[];

  @ApiPropertyOptional({ description: 'NIT para facturación FEL; vacío = CF (consumidor final)' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  billingNit?: string;

  @ApiPropertyOptional({ description: 'Nombre de facturación FEL' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  billingName?: string;

  @ApiPropertyOptional({ description: 'Dirección de facturación FEL' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  billingAddress?: string;
}
