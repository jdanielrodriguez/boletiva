import { Module } from '@nestjs/common';
import { PromotersController } from './promoters.controller';
import { PromotersService } from './promoters.service';

/** Autorización de promotores + panel admin. Exporta el servicio para que Events
 * verifique que solo un promotor aprobado (o admin) puede operar. */
@Module({
  controllers: [PromotersController],
  providers: [PromotersService],
  exports: [PromotersService],
})
export class PromotersModule {}
