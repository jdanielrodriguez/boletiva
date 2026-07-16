import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { StreamController } from './stream.controller';
import { StreamService } from './stream.service';

/**
 * Bus de eventos para push por SSE. @Global: `StreamService` se inyecta en los
 * servicios que publican cambios (pagos, checkout) sin re-importar el módulo.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [StreamController],
  providers: [StreamService],
  exports: [StreamService],
})
export class StreamModule {}
