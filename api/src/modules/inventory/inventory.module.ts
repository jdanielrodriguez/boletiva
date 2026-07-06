import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { SeatHoldService } from './seat-hold.service';

@Module({
  controllers: [InventoryController],
  providers: [SeatHoldService],
  exports: [SeatHoldService],
})
export class InventoryModule {}
