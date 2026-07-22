import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { EventRemindersService } from './event-reminders.service';

/**
 * Notificaciones (T5). @Global para que cualquier módulo (promoters, support,
 * settlement, events) inyecte NotificationsService y dispare avisos. JwtModule para
 * el handshake del gateway.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway, EventRemindersService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
