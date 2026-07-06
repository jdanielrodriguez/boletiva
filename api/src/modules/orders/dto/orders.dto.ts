import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

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
}
