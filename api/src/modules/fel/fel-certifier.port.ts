/**
 * Puerto del certificador de facturación electrónica (FEL, SAT Guatemala).
 *
 * El backend NUNCA habla directo con el SAT: hay un CERTIFICADOR intermediario
 * (Infile / Digifact / Guatefacturas / …) que firma y timbra el DTE. Este puerto
 * abstrae a ese proveedor: hoy lo implementa un STUB determinista (sandbox/tests);
 * el proveedor real se conecta detrás del mismo token cuando lleguen credenciales.
 *
 * Toda certificación es ASÍNCRONA (se encola): una factura JAMÁS bloquea la entrega
 * del boleto. Si el certificador no está disponible o falla, se reintenta.
 */

/** NIT de consumidor final (SAT): receptor por defecto y destino del fallback. */
export const CONSUMIDOR_FINAL_NIT = 'CF';

/** Token de inyección del certificador FEL. */
export const FEL_CERTIFIER = Symbol('FEL_CERTIFIER');

/** Qué juego de factura es: la de la plataforma (servicio) o la del promotor (neto). */
export type FelInvoiceType = 'platform' | 'promoter';

/** Una línea del DTE (detalle de la factura). Montos como string decimal (nunca number). */
export interface FelLineItem {
  description: string;
  quantity: number;
  /** Precio unitario en GTQ, string decimal (p.ej. "100.00"). */
  unitPrice: string;
  /** Total de la línea en GTQ, string decimal. */
  total: string;
}

/** Datos de entrada para emitir UN DTE (Documento Tributario Electrónico). */
export interface FelInvoiceInput {
  /** NIT del emisor (plataforma o promotor, según `type`). */
  emisorNit: string;
  /** NIT del receptor (comprador). 'CF' = consumidor final. */
  receptorNit: string;
  /** Nombre del receptor (opcional; requerido por el SAT si el NIT no es CF). */
  receptorName?: string;
  /** Dirección del receptor (opcional). */
  receptorAddress?: string;
  /** Detalle de la factura. */
  items: FelLineItem[];
  /** Moneda ISO (GTQ). */
  currency: string;
  /** Gran total del DTE en GTQ, string decimal. */
  total: string;
  /** IVA del DTE en GTQ, string decimal. */
  iva: string;
  /** Qué factura del par es (plataforma vs promotor). */
  type: FelInvoiceType;
  /**
   * ID de correlación (order.id o hash del quote): se estampa en las observaciones
   * del DTE para trazar la factura de vuelta a la orden que la originó.
   */
  correlationId: string;
}

/** Resultado de autorización del DTE (los datos que devuelve el SAT vía certificador). */
export interface FelCertResult {
  /** UUID de autorización del SAT. */
  uuid: string;
  /** Serie del documento. */
  serie: string;
  /** Número del documento. */
  numero: string;
  /** Fecha/hora de certificación. */
  certifiedAt: Date;
  /**
   * NIT del receptor efectivamente CERTIFICADO. Puede diferir del solicitado si hubo
   * fallback a 'CF' (consumidor final) por NIT inválido.
   */
  receptorNit: string;
}

/**
 * Error de NIT de receptor rechazado por el certificador (NIT inexistente/inválido en
 * el padrón del SAT). Dispara el fallback a Consumidor Final ('CF') en el servicio.
 */
export class FelInvalidNitError extends Error {
  constructor(public readonly nit: string) {
    super(`NIT de receptor rechazado por el certificador FEL: ${nit}`);
    this.name = 'FelInvalidNitError';
  }
}

/** Puerto del certificador FEL. Implementado por el stub (hoy) o el proveedor real (futuro). */
export interface FelCertifier {
  /**
   * Certifica (timbra) UN DTE. Lanza `FelInvalidNitError` si el receptorNit no es válido
   * para que el servicio reintente con 'CF'. Cualquier otro fallo se propaga (BullMQ
   * reintenta el job con backoff).
   */
  certify(input: FelInvoiceInput): Promise<FelCertResult>;
}
