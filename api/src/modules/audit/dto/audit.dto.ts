import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/** Cuerpo de un click de confirmación / acción sensible (autenticado). */
export class ConfirmAuditDto {
  @ApiProperty({
    description: 'Acción confirmada (p.ej. "promoter.approve", "event.publish")',
    maxLength: 120,
  })
  @IsString()
  @MaxLength(120)
  action!: string;

  @ApiPropertyOptional({
    description: 'Recurso afectado (id o referencia legible)',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  resource?: string;

  @ApiPropertyOptional({
    description: 'Contexto adicional (jsonb). NO se confía en él para IP/UA (esos van server-side)',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

/** Un registro de la bitácora. */
export class AuditEventDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Secuencia monótona (string por ser BigInt)' })
  seq!: string;

  @ApiProperty({ nullable: true, description: 'Usuario que ejecutó la acción' })
  userId!: string | null;

  @ApiProperty()
  action!: string;

  @ApiProperty({ nullable: true })
  resource!: string | null;

  @ApiProperty({ nullable: true, description: 'IP capturada server-side' })
  ip!: string | null;

  @ApiProperty({ nullable: true, description: 'User-agent capturado server-side' })
  userAgent!: string | null;

  @ApiProperty({ nullable: true })
  payload!: unknown;

  @ApiProperty()
  prevHash!: string;

  @ApiProperty()
  hash!: string;

  @ApiProperty()
  createdAt!: Date;
}

/** Página keyset de la bitácora. */
export class AuditPageDto {
  @ApiProperty({ type: AuditEventDto, isArray: true })
  items!: AuditEventDto[];

  @ApiProperty({ nullable: true, description: 'Cursor para la siguiente página' })
  nextCursor!: string | null;
}

/** Resultado de verificar la integridad de la cadena. */
export class AuditVerifyDto {
  @ApiProperty({ description: 'true si la cadena está íntegra' })
  ok!: boolean;

  @ApiPropertyOptional({ description: 'seq del primer registro corrupto (si ok=false)' })
  brokenAt?: string;
}
