import { Module } from '@nestjs/common';
import { PromotersController } from './promoters.controller';
import { PromotersService } from './promoters.service';
import { PromoterInvitationsController } from './promoter-invitations.controller';
import { PromoterInvitationsService } from './promoter-invitations.service';

/** Autorización de promotores + panel admin + invitaciones por token (F4). Exporta
 * el servicio para que Events verifique que solo un promotor aprobado (o admin)
 * puede operar. */
@Module({
  controllers: [PromotersController, PromoterInvitationsController],
  providers: [PromotersService, PromoterInvitationsService],
  exports: [PromotersService],
})
export class PromotersModule {}
