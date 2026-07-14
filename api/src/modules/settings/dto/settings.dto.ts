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

export class PublicConfigDto {
  @ApiProperty({
    description: 'Si un visitante (sin sesión) puede cambiar el idioma de la UI.',
    example: false,
  })
  allowVisitorLangSwitch!: boolean;

  @ApiProperty({
    description: 'Si se muestran las categorías en la página principal.',
    example: true,
  })
  showHomeCategories!: boolean;

  @ApiProperty({
    description: 'Integraciones externas configuradas y disponibles (gating de UI).',
    example: {
      recurrente: false,
      pagalo: false,
      fel: false,
      appleWallet: false,
      googleWallet: false,
      recaptcha: false,
    },
    additionalProperties: { type: 'boolean' },
  })
  capabilities!: Record<string, boolean>;

  @ApiProperty({
    description: 'Site key pública de reCAPTCHA (vacía si no está configurada).',
    example: '',
  })
  recaptchaSiteKey!: string;
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
