import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ValidatorsService } from './validators.service';
import { EventValidatorsController, ValidatorClaimController } from './validators.controller';

/** Validadores de boletos: invitación por email (código + magic-link) + canje a token
 * de puerta. Reusa la infra SafeTix (gate_assignments/manifiesto/checkins). */
@Module({
  imports: [JwtModule.register({})],
  controllers: [EventValidatorsController, ValidatorClaimController],
  providers: [ValidatorsService],
  exports: [ValidatorsService],
})
export class ValidatorsModule {}
