import { ApiProperty } from '@nestjs/swagger';

/**
 * Respuestas de contrato reutilizables. Se anotan con @ApiProperty para que
 * queden en el OpenAPI (y por ende en el SDK tipado del frontend). Son SOLO de
 * documentación: no cambian el comportamiento en tiempo de ejecución.
 */

/** Respuesta simple con un mensaje (confirmaciones, acciones sin payload). */
export class MessageResponseDto {
  @ApiProperty({ example: 'ok', description: 'Mensaje de resultado' })
  message!: string;
}

/** Respuesta booleana simple. */
export class OkResponseDto {
  @ApiProperty({ example: true, description: 'Resultado de la operación' })
  ok!: boolean;
}
