import { Global, Module } from '@nestjs/common';
import { CaptchaService } from './captcha.service';

/**
 * Verificación reCAPTCHA global (anti-abuso). @Global → el CaptchaGuard y cualquier
 * módulo (auth) inyectan CaptchaService sin re-importar. Depende de
 * IntegrationsService (ya @Global) para decidir si la verificación aplica u OMITE.
 * Ver [[captcha.service]].
 */
@Global()
@Module({
  providers: [CaptchaService],
  exports: [CaptchaService],
})
export class CaptchaModule {}
