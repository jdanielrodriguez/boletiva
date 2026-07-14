import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { REQUIRE_CAPTCHA } from '../decorators/require-captcha.decorator';
import { CaptchaService } from '../../infra/captcha/captcha.service';

/**
 * Guard de reCAPTCHA: solo actúa en rutas marcadas con @RequireCaptcha(). Toma el
 * token del header `x-captcha-token` (o del body `captchaToken`), lo verifica con
 * CaptchaService y, si falla, lanza 403. Si la integración no está configurada,
 * `verify` devuelve `true` → la ruta pasa (no bloquea pruebas/dev).
 *
 * Se aplica por método con @UseGuards(CaptchaGuard) — NO es global, así el resto de
 * la app no paga el chequeo del metadato.
 */
@Injectable()
export class CaptchaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly captcha: CaptchaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.getAllAndOverride<string | boolean>(REQUIRE_CAPTCHA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!action) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers['x-captcha-token'];
    const fromHeader = Array.isArray(header) ? header[0] : header;
    const fromBody = (req.body as { captchaToken?: unknown } | undefined)?.captchaToken;
    const token = fromHeader ?? (typeof fromBody === 'string' ? fromBody : '') ?? '';

    const expectedAction = typeof action === 'string' ? action : undefined;
    const ok = await this.captcha.verify(token, expectedAction, req.ip);
    if (!ok) throw new ForbiddenException('Captcha inválido');
    return true;
  }
}
