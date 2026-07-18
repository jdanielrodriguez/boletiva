import { ApiProperty } from '@nestjs/swagger';
import { ValidatorStatus } from '@prisma/client';
import { IsEmail, IsString, MinLength } from 'class-validator';

// ---- Requests ----

export class InviteValidatorDto {
  @ApiProperty({ example: 'validador@correo.com', description: 'Email del validador a habilitar' })
  @IsEmail()
  email!: string;
}

export class ClaimValidatorDto {
  @ApiProperty({ description: 'Token del magic-link recibido por correo' })
  @IsString()
  @MinLength(10)
  token!: string;
}

// ---- Responses ----

/** Resultado de invitar/re-habilitar: url y code se muestran UNA sola vez. */
export class ValidatorInviteResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: ValidatorStatus }) status!: ValidatorStatus;
  @ApiProperty({ description: 'Magic-link para abrir el validador (mostrar/compartir una vez)' })
  url!: string;
  @ApiProperty({ description: 'Código de acceso de un solo uso (mostrar una vez)' })
  code!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}

/** Un validador en la lista de gestión del evento. */
export class ValidatorListItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ format: 'uuid' }) operatorId!: string;
  @ApiProperty({ enum: ValidatorStatus }) status!: ValidatorStatus;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

class ClaimEventDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ format: 'date-time' }) startsAt!: string;
}

/** Canje del magic-link → token de PUERTA corto para la PWA. */
export class ClaimResponseDto {
  @ApiProperty({ description: 'JWT de puerta (corto) para pedir el manifiesto y validar' })
  gateToken!: string;
  @ApiProperty({ description: 'Vigencia del token de puerta (segundos)' }) expiresIn!: number;
  @ApiProperty({ format: 'uuid' }) gateEventId!: string;
  @ApiProperty({ type: ClaimEventDto }) event!: ClaimEventDto;
}

export class ValidatorPeekDto {
  @ApiProperty() email!: string;
  @ApiProperty() eventName!: string;
  @ApiProperty() valid!: boolean;
}

export class ValidatorDisabledDto {
  @ApiProperty({ description: 'true (uno) o cantidad deshabilitada (todos)' })
  disabled!: boolean | number;
}

// ---- Dashboard de check-ins (Fase 2) ----

class CheckinByLocalityDto {
  @ApiProperty({ format: 'uuid' }) localityId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Boletos vigentes de la localidad' }) total!: number;
  @ApiProperty({ description: 'Ya validados (check-in)' }) checkedIn!: number;
}

class CheckinByValidatorDto {
  @ApiProperty({ format: 'uuid', nullable: true }) operatorId!: string | null;
  @ApiProperty({ nullable: true }) email!: string | null;
  @ApiProperty({ nullable: true }) name!: string | null;
  @ApiProperty({ description: 'Boletos validados por este validador' }) count!: number;
}

class CheckinRecentDto {
  @ApiProperty() serial!: string;
  @ApiProperty({ nullable: true }) locality!: string | null;
  @ApiProperty({ nullable: true, description: 'Email del validador que escaneó' }) validator!: string | null;
  @ApiProperty({ format: 'date-time' }) at!: string;
}

/** Estado del dashboard de check-ins del evento. */
export class CheckinStatsDto {
  @ApiProperty({ format: 'uuid' }) eventId!: string;
  @ApiProperty({ description: 'Boletos vigentes (excluye revocados)' }) total!: number;
  @ApiProperty({ description: 'Ya validados en puerta' }) checkedIn!: number;
  @ApiProperty({ description: 'Sin validar todavía' }) pending!: number;
  @ApiProperty() transferred!: number;
  @ApiProperty() revoked!: number;
  @ApiProperty({ description: 'Intentos de doble check-in registrados' }) conflicts!: number;
  @ApiProperty({ description: '% de avance (checkedIn/total)' }) percent!: number;
  @ApiProperty({ type: CheckinByLocalityDto, isArray: true }) byLocality!: CheckinByLocalityDto[];
  @ApiProperty({ type: CheckinByValidatorDto, isArray: true }) byValidator!: CheckinByValidatorDto[];
  @ApiProperty({ type: CheckinRecentDto, isArray: true }) recent!: CheckinRecentDto[];
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
