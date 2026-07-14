import { Global, Module } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';

/**
 * Registro global de capacidades de integraciones externas (configurables por env).
 * Global → cualquier módulo (pagos, wallet, FEL, captcha) inyecta IntegrationsService
 * sin re-importar. Ver [[integrations.service]].
 */
@Global()
@Module({
  providers: [IntegrationsService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
