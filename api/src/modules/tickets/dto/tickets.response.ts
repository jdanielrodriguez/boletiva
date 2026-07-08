import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TicketEventType, TicketStatus, TransferStatus } from '@prisma/client';

/**
 * DTOs de respuesta del módulo de boletos (tickets, gate-access, manifest,
 * transfers, validation-ingest). SOLO documentación (OpenAPI/SDK): no cambian el
 * comportamiento en runtime. Modelan fielmente lo que devuelven los services.
 * Convención: Decimal→string, fechas→date-time, IDs→uuid, enums con {enum}.
 */

/** Evento anidado (selección `{ name, slug, startsAt }`) en el resumen de boleto. */
export class TicketEventSummaryDto {
  @ApiProperty({ example: 'Concierto de Apertura' })
  name!: string;

  @ApiProperty({ example: 'concierto-de-apertura' })
  slug!: string;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-08-15T02:00:00.000Z' })
  startsAt!: string;
}

/** Resumen de un boleto tal como lo retorna `TicketsService.toSummary`. */
export class TicketResponseDto {
  @ApiProperty({ format: 'uuid', example: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' })
  id!: string;

  @ApiProperty({ example: 'PE7K3M9Q', description: 'Serial público legible (base del QR)' })
  serial!: string;

  @ApiProperty({ enum: TicketStatus, example: TicketStatus.valid })
  status!: TicketStatus;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Asiento asignado (null en admisión general no materializada por asiento)',
  })
  seatId!: string | null;

  @ApiProperty({ format: 'uuid', description: 'Evento del boleto' })
  eventId!: string;

  @ApiPropertyOptional({ type: () => TicketEventSummaryDto, description: 'Evento anidado (si se incluyó)' })
  event?: TicketEventSummaryDto;

  @ApiProperty({ example: true, description: 'Si la media (QR/PDF) ya está generada' })
  mediaReady!: boolean;
}

/** Página keyset de boletos: `{ items, nextCursor }` (orden por issuedAt desc). */
export class TicketPageResponseDto {
  @ApiProperty({ type: TicketResponseDto, isArray: true, description: 'Boletos de la página' })
  items!: TicketResponseDto[];

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Cursor para la siguiente página (id de la última fila); null si no hay más',
    example: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  })
  nextCursor!: string | null;
}

/** Valor rotativo actual del QR (`GET /tickets/:id/qr`). */
export class TicketQrResponseDto {
  @ApiProperty({ format: 'uuid' })
  ticketId!: string;

  @ApiProperty({ example: 'PE7K3M9Q' })
  serial!: string;

  @ApiProperty({ enum: TicketStatus, example: TicketStatus.valid })
  status!: TicketStatus;

  @ApiProperty({ example: 'PE1.PE7K3M9Q.482913', description: 'Valor a codificar en el QR (rotativo)' })
  payload!: string;

  @ApiProperty({ example: 30, description: 'Segundos antes de que el QR rote (refrescar antes)' })
  refreshInSeconds!: number;
}

/** URLs firmadas de la media del boleto (`GET /tickets/:id/media`). */
export class TicketMediaResponseDto {
  @ApiProperty({ example: 'https://storage.pasaeventos.com/tickets/.../pass.pdf?sig=...' })
  pdfUrl!: string;

  @ApiProperty({ example: 'https://storage.pasaeventos.com/tickets/.../qr.png?sig=...' })
  qrUrl!: string;
}

/** Resultado de validar un QR en puerta (`POST /tickets/verify`, unión válido/inválido). */
export class VerifyTicketResultDto {
  @ApiProperty({ example: true, description: 'true = boleto válido; false = rechazado' })
  valid!: boolean;

  @ApiPropertyOptional({
    example: 'expired_or_invalid_code',
    description:
      'Motivo del rechazo (solo si valid=false): malformed | not_found | expired_or_invalid_code | bad_signature | revoked | transferred | already_used',
  })
  reason?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'ID del boleto (solo si valid=true)' })
  ticketId?: string;

  @ApiPropertyOptional({ example: 'PE7K3M9Q', description: 'Serial (presente en válidos y en la mayoría de rechazos)' })
  serial?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Evento (solo si valid=true)' })
  eventId?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'A-14',
    description: 'Etiqueta del asiento (solo si valid=true; null en GA)',
  })
  seatLabel?: string | null;

  @ApiPropertyOptional({ example: true, description: 'Si se marcó el check-in en esta validación (solo si valid=true)' })
  checkedIn?: boolean;
}

/** Integridad de la cadena de custodia (`verifyChain`). */
export class CustodyIntegrityDto {
  @ApiProperty({ example: true, description: 'Si la cadena hash es íntegra' })
  ok!: boolean;

  @ApiPropertyOptional({ example: 3, description: 'Seq del eslabón roto (solo si ok=false)' })
  brokenAt?: number;
}

/** Un movimiento de la cadena de custodia (registro completo de `TicketCustodyEvent`). */
export class CustodyEventDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  ticketId!: string;

  @ApiProperty({ example: 1, description: 'Orden dentro del boleto (1..n)' })
  seq!: number;

  @ApiProperty({ enum: TicketEventType, example: TicketEventType.issued })
  type!: TicketEventType;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Dueño saliente' })
  fromOwnerId!: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Dueño entrante' })
  toOwnerId!: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Quién ejecutó el movimiento' })
  actorId!: string | null;

  @ApiProperty({ example: '', description: "Hash del eslabón anterior ('' en el génesis)" })
  prevHash!: string;

  @ApiProperty({ example: 'a1b2c3...', description: 'Hash del eslabón (sha256 encadenado)' })
  hash!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Metadatos del movimiento (p.ej. fuente/puerta del ingest offline)',
  })
  meta!: Record<string, unknown> | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Cadena de custodia de un boleto + integridad (`GET /tickets/:id/custody`). */
export class TicketCustodyResponseDto {
  @ApiProperty({ type: () => CustodyIntegrityDto })
  integrity!: CustodyIntegrityDto;

  @ApiProperty({ type: () => CustodyEventDto, isArray: true, description: 'Movimientos en orden cronológico' })
  events!: CustodyEventDto[];
}

/** Pase de wallet emitido (`POST /tickets/:id/wallet`). */
export class WalletPassResponseDto {
  @ApiProperty({ enum: ['google', 'apple'], example: 'google' })
  platform!: string;

  @ApiProperty({
    example: 'https://pay.google.com/gp/v/save/STUB-PE7K3M9Q',
    description: 'URL "Save to Wallet" (Google) o URL firmada del .pkpass (Apple)',
  })
  url!: string;

  @ApiProperty({ example: 'stub', description: 'Proveedor que emitió el pase' })
  provider!: string;

  @ApiProperty({ example: '0.00', description: 'Cargo EXTRA aplicado por generar el pase (Decimal como string)' })
  feeApplied!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Detalle del reparto del cargo extra promotor↔plataforma (null si no hubo cargo)',
  })
  costShare!: Record<string, unknown> | null;
}

/** Transferencia iniciada (`POST /tickets/:id/transfer`). El código se muestra UNA sola vez. */
export class TransferInitiatedDto {
  @ApiProperty({ format: 'uuid', description: 'ID de la transferencia pendiente' })
  transferId!: string;

  @ApiProperty({ example: 'K7MNPQ23', description: 'Código a compartir con el destinatario (solo aquí)' })
  code!: string;

  @ApiProperty({ type: String, format: 'date-time', description: 'Vencimiento del código' })
  expiresAt!: string;
}

/** Resultado de canjear un código (`POST /tickets/transfers/claim`). */
export class TransferClaimedDto {
  @ApiProperty({ format: 'uuid', description: 'Boleto re-emitido al nuevo dueño' })
  ticketId!: string;

  @ApiProperty({ example: 'PE7K3M9Q' })
  serial!: string;

  @ApiProperty({ example: 'valid', description: 'Estado del boleto tras el canje' })
  status!: string;

  @ApiProperty({ format: 'uuid', description: 'Dueño anterior (remitente)' })
  transferredFrom!: string;
}

/** Transferencia pendiente propia (`GET /tickets/transfers/outgoing`). */
export class OutgoingTransferDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  ticketId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Transferencia cancelada (`DELETE /tickets/transfers/:id`). */
export class TransferCancelledDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: TransferStatus, example: TransferStatus.cancelled })
  status!: TransferStatus;
}

/** Usuario operador anidado en la asignación de puerta. */
export class GateOperatorSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'operador@pasaeventos.com' })
  email!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Ana' })
  firstName!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'López' })
  lastName!: string | null;
}

/** Asignación operador↔evento (`GET`/`POST /events/:id/gate-operators`). */
export class GateAssignmentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ format: 'uuid' })
  operatorId!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Quién creó la asignación' })
  createdById!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiPropertyOptional({
    type: () => GateOperatorSummaryDto,
    description: 'Datos del operador (incluidos en el listado; ausentes al crear)',
  })
  operator?: GateOperatorSummaryDto;
}

/** Resultado de revocar una asignación (`DELETE /events/:id/gate-operators/:operatorId`). */
export class RevokedCountDto {
  @ApiProperty({ example: 1, description: 'Cantidad de asignaciones revocadas' })
  revoked!: number;
}

/** Token de puerta corto/fresco (`POST /events/:id/gate-token`). */
export class GateTokenDto {
  @ApiProperty({ description: 'JWT de vida corta con claim gateEventId', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  token!: string;

  @ApiProperty({ example: 1800, description: 'Vigencia del token en segundos' })
  expiresIn!: number;

  @ApiProperty({ format: 'uuid', description: 'Evento al que queda acotado el token' })
  gateEventId!: string;
}

/** Una entrada del manifiesto de validación offline (lleva el secreto TOTP en claro). */
export class ManifestEntryDto {
  @ApiProperty({ format: 'uuid' })
  ticketId!: string;

  @ApiProperty({ example: 'PE7K3M9Q' })
  serial!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'A-14', description: 'Etiqueta del asiento (null en GA)' })
  seatLabel!: string | null;

  @ApiProperty({ format: 'uuid', description: 'Dueño actual del boleto' })
  ownerId!: string;

  @ApiProperty({ enum: TicketStatus, example: TicketStatus.valid })
  status!: TicketStatus;

  @ApiProperty({ example: 'MEUCIQ...', description: 'Firma Ed25519 (base64) de la identidad del boleto' })
  signature!: string;

  @ApiProperty({ example: 'k1', description: 'ID de la llave de firma (rotación)' })
  signingKeyId!: string;

  @ApiProperty({
    example: 'JBSWY3DPEHPK3PXP',
    description: 'Secreto TOTP en claro (base32) — el device recomputa el QR rotativo offline',
  })
  totpSecret!: string;

  @ApiPropertyOptional({ enum: TicketEventType, description: 'Último movimiento que dejó al boleto en este estado' })
  reason?: TicketEventType;
}

/** Manifiesto firmado de validación offline (`GET /events/:id/manifest`). */
export class ManifestResponseDto {
  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ example: 128, description: 'Mayor seq incluido (cursor para el próximo pull ?since)' })
  maxSeq!: number;

  @ApiProperty({ example: 'k1', description: 'ID de la llave de firma del manifiesto' })
  keyId!: string;

  @ApiProperty({
    example: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n',
    description: 'Llave pública Ed25519 (PEM) para verificar la firma offline',
  })
  publicKeyPem!: string;

  @ApiProperty({ example: 42, description: 'Cantidad de boletos en el manifiesto' })
  count!: number;

  @ApiProperty({ type: () => ManifestEntryDto, isArray: true, description: 'Estado por boleto (orden estable)' })
  tickets!: ManifestEntryDto[];

  @ApiProperty({ example: 'a1b2c3...', description: 'sha256 del digest canónico firmado' })
  contentHash!: string;

  @ApiProperty({ example: 'MEUCIQ...', description: 'Firma Ed25519 (base64) del contentHash' })
  signature!: string;

  @ApiProperty({ type: String, format: 'date-time', description: 'Momento de generación (dentro del contenido firmado)' })
  generatedAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Expiración firmada (SafeTix): el device rechaza offline un manifiesto vencido',
  })
  expiresAt!: string;
}

/** Reconciliación de un lote de check-ins (`POST /checkins/batch`, unión inline/async). */
export class BatchCheckinResultDto {
  @ApiProperty({ enum: ['inline', 'async'], example: 'async', description: 'Modo de procesamiento' })
  mode!: string;

  @ApiPropertyOptional({ example: 120, description: 'Check-ins aceptados y publicados al bus (solo modo async)' })
  accepted?: number;

  @ApiPropertyOptional({ example: 120, description: 'Total procesado (solo modo inline)' })
  total?: number;

  @ApiPropertyOptional({ example: 118, description: 'Marcados como usados (solo modo inline)' })
  checkedIn?: number;

  @ApiPropertyOptional({ example: 1, description: 'Dobles check-in detectados (solo modo inline)' })
  alreadyUsed?: number;

  @ApiPropertyOptional({ example: 1, description: 'Seriales inexistentes (solo modo inline)' })
  notFound?: number;

  @ApiPropertyOptional({ example: 0, description: 'Boletos en estado inválido: revocado/transferido (solo modo inline)' })
  invalid?: number;
}

/** Conflicto de validación registrado (`GET /events/:id/checkins/conflicts`). */
export class CheckinConflictDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  ticketId!: string;

  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ example: 'PE7K3M9Q' })
  serial!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'gate-3', description: 'Puerta que reintentó validar' })
  gateId!: string | null;

  @ApiProperty({ example: 'already_used', description: "Motivo: 'already_used' | 'invalid_state:<status>'" })
  reason!: string;

  @ApiProperty({ type: String, format: 'date-time', description: 'Momento del intento (posible offline)' })
  attemptedAt!: string;

  @ApiProperty({ type: String, format: 'date-time', description: 'Momento en que se registró el conflicto' })
  createdAt!: string;
}
