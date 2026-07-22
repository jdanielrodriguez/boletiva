import { Module } from '@nestjs/common';
import { AdvisorInvitationsController } from './advisor-invitations.controller';
import { AdvisorInvitationsService } from './advisor-invitations.service';
import { AdvisorsController } from './advisors.controller';
import { AdvisorsService } from './advisors.service';

/** Asesores (T7): invitación por correo + gestión (lista/deshabilitar/eliminar/notificar). */
@Module({
  controllers: [AdvisorInvitationsController, AdvisorsController],
  providers: [AdvisorInvitationsService, AdvisorsService],
  exports: [AdvisorInvitationsService],
})
export class AdvisorsModule {}
