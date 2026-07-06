import { Global, Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';

/** Global: el ledger es el back-end contable que usan pagos, wallet y payouts. */
@Global()
@Module({
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
