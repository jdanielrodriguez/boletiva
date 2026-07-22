import { Module } from '@nestjs/common';
import { EmailLogService } from './email-log.service';
import { EmailLogController } from './email-log.controller';

/** Registro de correos enviados (email log): consulta admin con filtros + búsqueda. */
@Module({
  controllers: [EmailLogController],
  providers: [EmailLogService],
})
export class EmailLogModule {}
