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
    description: 'Mantenimiento de reportes/dashboards de eventos, promotores y chequeo de boletos.',
    example: false,
  })
  reportsMaintenance!: boolean;

  @ApiProperty({
    description: 'Habilita el tour de onboarding guiado (una vez por usuario/página).',
    example: true,
  })
  tourEnabled!: boolean;

  @ApiProperty({
    description: 'Días para reofrecer un tour ya visto/saltado/rechazado (reinicio).',
    example: 30,
  })
  tourResetDays!: number;

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

  @ApiProperty({
    description: 'Perfil premium: interruptor maestro + prueba gratis + días (gating de UI del plan).',
    example: { enabled: false, trialEnabled: false, trialDays: 7 },
  })
  premium!: { enabled: boolean; trialEnabled: boolean; trialDays: number };

  @ApiProperty({ description: 'Si el chat de soporte está habilitado.', example: false })
  chatEnabled!: boolean;

  @ApiProperty({ description: 'Si los promotores pueden destacar sus eventos en el inicio.', example: false })
  canFeatureEvents!: boolean;

  @ApiProperty({ description: 'Si el slider del inicio está habilitado.', example: true })
  homeSliderEnabled!: boolean;

  @ApiProperty({ description: 'Si el mapa de asientos está habilitado.', example: true })
  seatmapEnabled!: boolean;

  @ApiProperty({ description: 'Si la creación de eventos está habilitada.', example: true })
  eventsCreationEnabled!: boolean;

  @ApiProperty({ description: 'Mantenimiento solo para asesores.', example: false })
  advisorsMaintenance!: boolean;

  @ApiProperty({ description: 'Mantenimiento de facturación.', example: false })
  billingMaintenance!: boolean;
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
