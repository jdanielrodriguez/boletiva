import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PromotersModule } from '../promoters/promoters.module';
import { SupportController } from './support.controller';
import { SupportExtrasController } from './support-extras.controller';
import { SupportService } from './support.service';
import { SupportMacrosService } from './support-macros.service';
import { SupportGateway } from './support.gateway';
import { SUPPORT_AUTORESPONDER, NoopAutoResponder } from './support-autoresponder';

/**
 * Tickets de soporte (T1; evoluciona el chat B3). JwtModule verifica el handshake del
 * gateway (secret por-llamada); PromotersModule aporta PremiumService (gating premium).
 * AuditService es global (auditoría de transiciones). RedisService es global (adapter).
 */
@Module({
  imports: [JwtModule.register({}), PromotersModule],
  controllers: [SupportController, SupportExtrasController],
  providers: [
    SupportService,
    SupportMacrosService,
    SupportGateway,
    // Respondedor automático del chat: hoy NO-OP (atención humana). Para activar un
    // bot/IA (T6+), reemplazar useClass por la impl. real — sin tocar el service.
    { provide: SUPPORT_AUTORESPONDER, useClass: NoopAutoResponder },
  ],
  exports: [SupportService],
})
export class SupportModule {}
