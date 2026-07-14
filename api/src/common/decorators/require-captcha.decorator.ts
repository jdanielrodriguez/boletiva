import { SetMetadata } from '@nestjs/common';

export const REQUIRE_CAPTCHA = 'require_captcha';

/**
 * Marca una ruta como protegida por reCAPTCHA: el CaptchaGuard leerá el token del
 * request (header `x-captcha-token` o body `captchaToken`) y lo verificará. El valor
 * opcional es la `action` esperada (v3) para el chequeo de coincidencia.
 */
export const RequireCaptcha = (action?: string) => SetMetadata(REQUIRE_CAPTCHA, action ?? true);
