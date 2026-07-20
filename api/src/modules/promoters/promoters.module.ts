import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PromotersController } from './promoters.controller';
import { PromotersService } from './promoters.service';
import { PremiumService } from './premium.service';
import { PromoterInvitationsController } from './promoter-invitations.controller';
import { PromoterInvitationsService } from './promoter-invitations.service';
import { PromoterMailService } from './promoter-mail.service';

/** Autorización de promotores + panel admin + invitaciones por token (F4) + perfil
 * PREMIUM (B1). Exporta los servicios para que Events verifique que solo un promotor
 * aprobado (o admin) puede operar y consulte los beneficios premium (destacar propio).
 * `PromoterMailService` envía los correos del ciclo (cola MAIL). */
@Module({
  imports: [AuthModule],
  controllers: [PromotersController, PromoterInvitationsController],
  providers: [PromotersService, PremiumService, PromoterInvitationsService, PromoterMailService],
  exports: [PromotersService, PremiumService],
})
export class PromotersModule {}
