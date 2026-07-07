import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service';

/** Global: cualquier módulo puede encolar trabajos asíncronos (BullMQ). */
@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
