import { Module } from '@nestjs/common';
import { KbController } from './kb.controller';
import { KbService } from './kb.service';
import { KbAutoResponderService } from './kb-auto-responder.service';

/**
 * Base de Conocimientos (T6): FAQ público (SSR/JSON-LD desde el frontend) + gestión
 * con editor de formato + autoresponder para el chat/bot. Exporta el autoresponder
 * para que el módulo de soporte pueda sugerir respuestas del KB.
 */
@Module({
  controllers: [KbController],
  providers: [KbService, KbAutoResponderService],
  exports: [KbAutoResponderService, KbService],
})
export class KbModule {}
