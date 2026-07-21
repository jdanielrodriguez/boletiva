import { Module } from '@nestjs/common';
import { AdvisorInvitationsController } from './advisor-invitations.controller';
import { AdvisorInvitationsService } from './advisor-invitations.service';

/** Asesores (T7): invitación por correo (confirmar rol o fijar contraseña). */
@Module({
  controllers: [AdvisorInvitationsController],
  providers: [AdvisorInvitationsService],
  exports: [AdvisorInvitationsService],
})
export class AdvisorsModule {}
