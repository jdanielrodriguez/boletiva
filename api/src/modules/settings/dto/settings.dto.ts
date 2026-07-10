import { ApiProperty } from '@nestjs/swagger';
import { IsDefined } from 'class-validator';

export class UpdateSettingDto {
  @ApiProperty({
    description: 'Nuevo valor (number para pct/int, boolean para bool). Validado contra el catálogo.',
    oneOf: [{ type: 'number' }, { type: 'boolean' }],
    example: 0.1,
  })
  @IsDefined()
  value!: number | boolean;
}

export class SettingViewDto {
  @ApiProperty({ example: 'costshare.default_pct' })
  key!: string;

  @ApiProperty({ oneOf: [{ type: 'number' }, { type: 'boolean' }], example: 0 })
  value!: number | boolean;

  @ApiProperty({ oneOf: [{ type: 'number' }, { type: 'boolean' }], example: 0 })
  default!: number | boolean;

  @ApiProperty({ enum: ['pct', 'int', 'bool'] })
  type!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ description: 'true = el motor de precios prioriza el fee_schedule sobre este valor' })
  fallbackOnly!: boolean;
}
