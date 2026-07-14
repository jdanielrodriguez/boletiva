import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  FelInvalidNitError,
  type FelCertResult,
  type FelCertifier,
  type FelInvoiceInput,
} from './fel-certifier.port';

/**
 * Certificador FEL de PRUEBAS: genera autorizaciones (uuid/serie/numero) simuladas de
 * forma DETERMINISTA (mismo input → mismo resultado) y SIN red. Reproduce el contrato
 * del certificador real para sandbox/E2E sin depender del SAT.
 *
 * Regla de simulación del fallback: un `receptorNit` que empiece por 'BAD' se considera
 * inválido y lanza `FelInvalidNitError` → el servicio reintenta con 'CF'.
 */
@Injectable()
export class StubFelCertifier implements FelCertifier {
  certify(input: FelInvoiceInput): Promise<FelCertResult> {
    if (input.receptorNit.toUpperCase().startsWith('BAD')) {
      return Promise.reject(new FelInvalidNitError(input.receptorNit));
    }

    // Semilla determinista: tipo + correlación + receptor → hash estable.
    const seed = `${input.type}|${input.emisorNit}|${input.receptorNit}|${input.correlationId}`;
    const hex = createHash('sha256').update(seed).digest('hex');

    const uuid = [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ]
      .join('-')
      .toUpperCase();

    const serie = hex.slice(0, 8).toUpperCase();
    // Número documental: 9 dígitos derivados del hash (estable, no cero).
    const numero = String((parseInt(hex.slice(32, 40), 16) % 900000000) + 100000000);

    return Promise.resolve({
      uuid,
      serie,
      numero,
      certifiedAt: new Date(0), // fijo → determinista (el servicio no depende de esta fecha para lógica)
      receptorNit: input.receptorNit,
    });
  }
}
