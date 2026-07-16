import { ApiProperty } from '@nestjs/swagger';
import { IsDefined } from 'class-validator';

export class UpdateSettingDto {
  @ApiProperty({
    description:
      'Nuevo valor (number para pct/int, boolean para bool, string para enum). Validado contra el catálogo.',
    oneOf: [{ type: 'number' }, { type: 'boolean' }, { type: 'string' }],
    example: 0.1,
  })
  @IsDefined()
  value!: number | boolean | string;
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

  @ApiProperty({
    description: 'Asignación de temas por franja + control del switch de tema.',
    example: {
      slots: { dia: 'marquesina', noche: 'pulso' },
      defaultFranja: 'noche',
      allowVisitorSwitch: true,
      autoByHour: false,
      dayStartHour: 6,
      dayEndHour: 18,
    },
  })
  theme!: {
    slots: { dia: string; noche: string };
    defaultFranja: string;
    allowVisitorSwitch: boolean;
    autoByHour: boolean;
    dayStartHour: number;
    dayEndHour: number;
  };
}

export class SettingViewDto {
  @ApiProperty({ example: 'costshare.default_pct' })
  key!: string;

  @ApiProperty({ oneOf: [{ type: 'number' }, { type: 'boolean' }, { type: 'string' }], example: 0 })
  value!: number | boolean | string;

  @ApiProperty({ oneOf: [{ type: 'number' }, { type: 'boolean' }, { type: 'string' }], example: 0 })
  default!: number | boolean | string;

  @ApiProperty({ enum: ['pct', 'int', 'bool', 'enum'] })
  type!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ required: false, type: [String], description: 'Valores permitidos (solo type=enum).' })
  options?: string[];

  @ApiProperty({ description: 'true = el motor de precios prioriza el fee_schedule sobre este valor' })
  fallbackOnly!: boolean;
}
