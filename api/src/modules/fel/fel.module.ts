import { Module } from '@nestjs/common';
import { FelService } from './fel.service';
import { FEL_CERTIFIER } from './fel-certifier.port';
import { StubFelCertifier } from './stub-fel-certifier';
import { BillingController } from './billing.controller';

/**
 * Facturación electrónica (FEL, SAT Guatemala) — Ola de integraciones.
 *
 * Certificación ASÍNCRONA (cola BullMQ `FEL`): una factura nunca bloquea la entrega.
 * El certificador se inyecta por el puerto `FEL_CERTIFIER`; hoy solo el STUB
 * determinista (sandbox/tests). El proveedor real (Infile/Digifact/…) se conecta
 * detrás del mismo token cuando lleguen credenciales.
 *
 * Exporta `FelService` para que Payments dispare `requestCertification(orderId)` tras
 * asentar el pago (encolar, sin bloquear el webhook).
 */
@Module({
  controllers: [BillingController],
  providers: [
    FelService,
    { provide: FEL_CERTIFIER, useClass: StubFelCertifier },
  ],
  exports: [FelService],
})
export class FelModule {}
