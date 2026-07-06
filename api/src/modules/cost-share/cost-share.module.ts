import { Global, Module } from '@nestjs/common';
import { CostShareController } from './cost-share.controller';
import { CostShareService } from './cost-share.service';

/** Global: futuros flujos (p.ej. pasar boleto a wallet) aplican gastos extra. */
@Global()
@Module({
  controllers: [CostShareController],
  providers: [CostShareService],
  exports: [CostShareService],
})
export class CostShareModule {}
