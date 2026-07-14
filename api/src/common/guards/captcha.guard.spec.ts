import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CaptchaGuard } from './captcha.guard';
import { CaptchaService } from '../../infra/captcha/captcha.service';

interface FakeReq {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  ip?: string;
}

/** ExecutionContext falso con el request dado. */
function ctx(req: FakeReq): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

/** Reflector falso: devuelve el metadato @RequireCaptcha configurado. */
function reflector(meta: string | boolean | undefined): Reflector {
  return { getAllAndOverride: () => meta } as unknown as Reflector;
}

/** CaptchaService falso: verify espía el token y devuelve `result`. */
function captcha(result: boolean): { svc: CaptchaService; verify: jest.Mock } {
  const verify = jest.fn().mockResolvedValue(result);
  return { svc: { verify } as unknown as CaptchaService, verify };
}

describe('CaptchaGuard', () => {
  it('sin @RequireCaptcha → pasa sin verificar', async () => {
    const { svc, verify } = captcha(true);
    const guard = new CaptchaGuard(reflector(undefined), svc);

    await expect(guard.canActivate(ctx({ headers: {} }))).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });

  it('con @RequireCaptcha y token válido (header) → pasa y propaga acción + ip', async () => {
    const { svc, verify } = captcha(true);
    const guard = new CaptchaGuard(reflector('login'), svc);

    await expect(
      guard.canActivate(ctx({ headers: { 'x-captcha-token': 'tok' }, ip: '9.9.9.9' })),
    ).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('tok', 'login', '9.9.9.9');
  });

  it('lee el token del body (captchaToken) si no viene en el header', async () => {
    const { svc, verify } = captcha(true);
    const guard = new CaptchaGuard(reflector(true), svc);

    await expect(
      guard.canActivate(ctx({ headers: {}, body: { captchaToken: 'from-body' } })),
    ).resolves.toBe(true);
    // metadato booleano → acción indefinida.
    expect(verify).toHaveBeenCalledWith('from-body', undefined, undefined);
  });

  it('token inválido → ForbiddenException', async () => {
    const { svc } = captcha(false);
    const guard = new CaptchaGuard(reflector('login'), svc);

    await expect(
      guard.canActivate(ctx({ headers: { 'x-captcha-token': 'malo' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('servicio no disponible (verify true por omisión) → pasa aunque no haya token', async () => {
    // El servicio omite la verificación y devuelve true; el guard confía en él.
    const { svc, verify } = captcha(true);
    const guard = new CaptchaGuard(reflector('signup'), svc);

    await expect(guard.canActivate(ctx({ headers: {} }))).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('', 'signup', undefined);
  });
});
