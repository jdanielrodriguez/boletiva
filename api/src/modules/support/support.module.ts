import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PromotersModule } from '../promoters/promoters.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { SupportGateway } from './support.gateway';

/**
 * Tickets de soporte (T1; evoluciona el chat B3). JwtModule verifica el handshake del
 * gateway (secret por-llamada); PromotersModule aporta PremiumService (gating premium).
 * AuditService es global (auditoría de transiciones). RedisService es global (adapter).
 */
@Module({
  imports: [JwtModule.register({}), PromotersModule],
  controllers: [SupportController],
  providers: [SupportService, SupportGateway],
  exports: [SupportService],
})
export class SupportModule {}
