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
