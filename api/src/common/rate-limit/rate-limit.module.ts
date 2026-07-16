import { Global, Module } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';

/**
 * Rate-limiting global sobre Redis. Expone `RateLimitService` (reutilizable por otros
 * anti-abusos, p.ej. lockout de login). El guard global se registra en AppModule.
 */
@Global()
@Module({
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}
