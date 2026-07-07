import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { WalletWithdrawalService } from './wallet-withdrawal.service';

@Module({
  controllers: [WalletController],
  providers: [WalletService, WalletWithdrawalService],
  exports: [WalletService, WalletWithdrawalService],
})
export class WalletModule {}
