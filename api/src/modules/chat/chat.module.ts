import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PromotersModule } from '../promoters/promoters.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';

/**
 * Chat de soporte (B3). JwtModule para verificar el handshake del gateway (secret
 * por-llamada); PromotersModule aporta PremiumService (gating premium del chat).
 */
@Module({
  imports: [JwtModule.register({}), PromotersModule],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway],
  exports: [ChatService],
})
export class ChatModule {}
