import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthService } from './auth.service';

// bcrypt real es lento (12 rounds) y no aporta al test de ramas: se mockea para
// controlar compare()/hash() de forma determinista.
jest.mock('bcrypt', () => ({
  hash: jest.fn(async () => 'NEW_HASH'),
  compare: jest.fn(),
}));
const bcrypt = require('bcrypt');

/**
 * Cobertura de RAMAS de AuthService (los BORDES; login/signup felices viven en los
 * e2e de auth): verificación de correo por token, reenvío, passwordless por token,
 * Google (usuario nuevo / existente sin verificar / verificado), logout, recuperación
 * y cambio de contraseña, y la preauth de 2FA inválida. Todas las dependencias
 * mockeadas.
 */
describe('AuthService (ramas de borde, unit)', () => {
  const makeUser = (over: Record<string, unknown> = {}) => ({
    id: 'u1',
    email: 'u1@x.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: null,
    avatarUrl: null,
    roles: [Role.buyer],
    status: 'active',
    emailVerifiedAt: new Date(),
    twoFactorMethod: 'email',
    language: 'es',
    passwordHash: 'HASH',
    ...over,
  });

  const build = () => {
    const prisma = {
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      passwordRecovery: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      oAuthAccount: { upsert: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const tokens = {
      issuePair: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 }),
      rotate: jest.fn(),
      revoke: jest.fn(),
      revokeAllForUser: jest.fn(),
    };
    const mail = { send: jest.fn().mockResolvedValue(undefined), sendTemplated: jest.fn().mockResolvedValue(undefined) };
    const config = { get: jest.fn(() => ['http://front.local']), getOrThrow: jest.fn(() => 'secret') };
    const jwt = { sign: jest.fn().mockReturnValue('preauth'), verify: jest.fn() };
    const challenges = { issue: jest.fn(), verifyCode: jest.fn(), verifyToken: jest.fn() };
    const devices = {
      touch: jest.fn(),
      trust: jest.fn(),
      isTrusted: jest.fn(),
      isKnownTrusted: jest.fn().mockResolvedValue(false),
    };
    const twofactor = { verify: jest.fn(), startChallenge: jest.fn() };
    const google = { verify: jest.fn(), enabled: true };
    // El avatar se firma al leer; sin avatarKey devuelve avatarUrl tal cual.
    const storage = { signedGetUrl: jest.fn().mockResolvedValue('https://signed/avatar') };
    const service = new AuthService(
      prisma as never,
      tokens as never,
      mail as never,
      config as never,
      jwt as never,
      challenges as never,
      devices as never,
      twofactor as never,
      google as never,
      storage as never,
    );
    return { prisma, tokens, mail, jwt, challenges, devices, twofactor, google, service };
  };

  const ctx = { ip: '1.2.3.4', userAgent: 'jest' };

  describe('login', () => {
    it('credenciales inválidas (usuario inexistente) → 401', async () => {
      const { prisma, service } = build();
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login({ email: 'x@x.com', password: 'p' }, ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('contraseña incorrecta → 401', async () => {
      const { prisma, service } = build();
      prisma.user.findUnique.mockResolvedValue(makeUser());
      bcrypt.compare.mockResolvedValue(false);
      await expect(service.login({ email: 'u1@x.com', password: 'mala' }, ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('cuenta inactiva → 401', async () => {
      const { prisma, service } = build();
      prisma.user.findUnique.mockResolvedValue(makeUser({ status: 'inactive' }));
      bcrypt.compare.mockResolvedValue(true);
      await expect(service.login({ email: 'u1@x.com', password: 'ok' }, ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('correo sin verificar → ok pero reenvía verificación (sin 2FA)', async () => {
      const { prisma, challenges, devices, service } = build();
      prisma.user.findUnique.mockResolvedValue(makeUser({ emailVerifiedAt: null }));
      prisma.user.update.mockResolvedValue(makeUser({ emailVerifiedAt: null }));
      bcrypt.compare.mockResolvedValue(true);
      devices.touch.mockResolvedValue({ device: {}, isNew: false });
      const res = await service.login({ email: 'u1@x.com', password: 'ok' }, ctx);
      expect(res.status).toBe('ok');
      expect(challenges.issue).toHaveBeenCalled();
    });

    it('verificado + dispositivo nuevo no confiable → 2fa_required (SIN aviso todavía)', async () => {
      const { prisma, mail, devices, twofactor, service } = build();
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.user.update.mockResolvedValue(makeUser());
      bcrypt.compare.mockResolvedValue(true);
      devices.touch.mockResolvedValue({ device: {}, isNew: true });
      devices.isTrusted.mockReturnValue(false);
      const res = await service.login({ email: 'u1@x.com', password: 'ok' }, {});
      expect(res.status).toBe('2fa_required');
      expect(twofactor.startChallenge).toHaveBeenCalled();
      // E2: el aviso de nuevo dispositivo se manda DESPUÉS de validar el 2FA, no aquí.
      expect(mail.sendTemplated).not.toHaveBeenCalled();
    });

    it('verificado + dispositivo no confiable pero conocido → 2fa_required sin aviso', async () => {
      const { prisma, mail, devices, service } = build();
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.user.update.mockResolvedValue(makeUser());
      bcrypt.compare.mockResolvedValue(true);
      devices.touch.mockResolvedValue({ device: {}, isNew: false });
      devices.isTrusted.mockReturnValue(false);
      const res = await service.login({ email: 'u1@x.com', password: 'ok' }, ctx);
      expect(res.status).toBe('2fa_required');
      expect(mail.sendTemplated).not.toHaveBeenCalled();
    });

    it('verificado + dispositivo confiable → ok con tokens', async () => {
      const { prisma, devices, service } = build();
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.user.update.mockResolvedValue(makeUser());
      bcrypt.compare.mockResolvedValue(true);
      devices.touch.mockResolvedValue({ device: {}, isNew: false });
      devices.isTrusted.mockReturnValue(true);
      const res = await service.login({ email: 'u1@x.com', password: 'ok' }, ctx);
      expect(res.status).toBe('ok');
    });
  });

  describe('verifyTwoFactor', () => {
    it('preauth válida + usuario inexistente → 401', async () => {
      const { prisma, jwt, service } = build();
      jwt.verify.mockReturnValue({ sub: 'u1', typ: '2fa' });
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.verifyTwoFactor('tok', '123456', ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('preauth válida + 2FA correcto → ok + confía dispositivo + aviso (E2)', async () => {
      const { prisma, jwt, twofactor, devices, mail, service } = build();
      jwt.verify.mockReturnValue({ sub: 'u1', typ: '2fa' });
      prisma.user.findUnique.mockResolvedValue(makeUser());
      twofactor.verify.mockResolvedValue(undefined);
      devices.isKnownTrusted.mockResolvedValue(false); // dispositivo nuevo
      const res = await service.verifyTwoFactor('tok', '123456', ctx);
      expect(res.status).toBe('ok');
      expect(devices.trust).toHaveBeenCalled();
      // E2: el aviso de nuevo dispositivo se envía AHORA (tras validar el 2FA).
      expect(mail.sendTemplated).toHaveBeenCalled();
    });

    it('código 2FA inválido → lanza y NO envía aviso ni confía dispositivo', async () => {
      const { prisma, jwt, twofactor, devices, mail, service } = build();
      jwt.verify.mockReturnValue({ sub: 'u1', typ: '2fa' });
      prisma.user.findUnique.mockResolvedValue(makeUser());
      twofactor.verify.mockRejectedValue(new BadRequestException('Código inválido'));
      await expect(service.verifyTwoFactor('tok', 'bad', ctx)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(devices.trust).not.toHaveBeenCalled();
      expect(mail.sendTemplated).not.toHaveBeenCalled();
    });

    it('2FA correcto en dispositivo YA confiable → ok sin aviso duplicado', async () => {
      const { prisma, jwt, twofactor, devices, mail, service } = build();
      jwt.verify.mockReturnValue({ sub: 'u1', typ: '2fa' });
      prisma.user.findUnique.mockResolvedValue(makeUser());
      twofactor.verify.mockResolvedValue(undefined);
      devices.isKnownTrusted.mockResolvedValue(true); // ya confiable
      const res = await service.verifyTwoFactor('tok', '123456', ctx);
      expect(res.status).toBe('ok');
      expect(mail.sendTemplated).not.toHaveBeenCalled();
    });
  });

  describe('passwordlessRequest', () => {
    it('usuario existente solo emite el reto', async () => {
      const { prisma, challenges, service } = build();
      prisma.user.findUnique.mockResolvedValue(makeUser());
      await service.passwordlessRequest('u1@x.com', undefined);
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(challenges.issue).toHaveBeenCalled();
    });

    it('usuario nuevo se crea (con firstName por defecto)', async () => {
      const { prisma, challenges, service } = build();
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(makeUser({ email: 'nuevo@x.com' }));
      await service.passwordlessRequest('nuevo@x.com', undefined);
      expect(prisma.user.create).toHaveBeenCalled();
      expect(challenges.issue).toHaveBeenCalled();
    });

    it('usuario nuevo con firstName provisto', async () => {
      const { prisma, service } = build();
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(makeUser({ email: 'nuevo@x.com' }));
      await service.passwordlessRequest('nuevo@x.com', 'Grace');
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ firstName: 'Grace' }) }),
      );
    });
  });

  describe('passwordlessVerifyCode', () => {
    it('canjea el código y completa (dispositivo confiado)', async () => {
      const { prisma, challenges, devices, service } = build();
      challenges.verifyCode.mockResolvedValue('u1');
      prisma.user.findUnique.mockResolvedValue({ emailVerifiedAt: new Date() }); // ya verificado
      prisma.user.update.mockResolvedValue(makeUser());
      const res = await service.passwordlessVerifyCode('u1@x.com', '123456', ctx);
      expect(res.status).toBe('ok');
      expect(devices.trust).toHaveBeenCalled();
    });
  });

  describe('me', () => {
    it('devuelve el usuario autenticado', async () => {
      const { prisma, service } = build();
      prisma.user.findUnique.mockResolvedValue(makeUser());
      const pub = await service.me('u1');
      expect(pub.id).toBe('u1');
    });

    it('usuario inexistente → 401', async () => {
      const { prisma, service } = build();
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.me('nope')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  it('googleEnabled refleja el proveedor', () => {
    const { service } = build();
    expect(service.googleEnabled).toBe(true);
  });

  it('refresh delega en tokens.rotate', async () => {
    const { tokens, service } = build();
    tokens.rotate.mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 });
    await service.refresh('r', ctx);
    expect(tokens.rotate).toHaveBeenCalledWith('r', ctx);
  });

  describe('verificación de correo', () => {
    it('verifyEmailByToken marca el correo verificado', async () => {
      const { prisma, challenges, service } = build();
      challenges.verifyToken.mockResolvedValue('u1');
      prisma.user.update.mockResolvedValue(makeUser({ emailVerifiedAt: new Date() }));
      const pub = await service.verifyEmailByToken('tok');
      expect(pub.emailVerified).toBe(true);
      expect(prisma.user.update).toHaveBeenCalled();
    });

    it('resendVerification: usuario inexistente no hace nada', async () => {
      const { prisma, challenges, service } = build();
      prisma.user.findUnique.mockResolvedValue(null);
      await service.resendVerification('x@x.com');
      expect(challenges.issue).not.toHaveBeenCalled();
    });

    it('resendVerification: correo ya verificado no reenvía', async () => {
      const { prisma, challenges, service } = build();
      prisma.user.findUnique.mockResolvedValue(makeUser({ emailVerifiedAt: new Date() }));
      await service.resendVerification('u1@x.com');
      expect(challenges.issue).not.toHaveBeenCalled();
    });

    it('resendVerification: correo sin verificar reenvía', async () => {
      const { prisma, challenges, service } = build();
      prisma.user.findUnique.mockResolvedValue(makeUser({ emailVerifiedAt: null }));
      await service.resendVerification('u1@x.com');
      expect(challenges.issue).toHaveBeenCalledWith('u1', 'u1@x.com', 'email_verify', {
        withMagicLink: true,
      });
    });
  });

  describe('passwordless por token', () => {
    it('canjea el magic link y confía el dispositivo', async () => {
      const { prisma, challenges, devices, service } = build();
      challenges.verifyToken.mockResolvedValue('u1');
      prisma.user.findUnique.mockResolvedValue({ emailVerifiedAt: null }); // notYetVerified
      prisma.user.update.mockResolvedValue(makeUser());
      const res = await service.passwordlessVerifyToken('tok', ctx);
      expect(res.status).toBe('ok');
      expect(devices.trust).toHaveBeenCalled();
    });

    it('completa aunque notYetVerified no encuentre el usuario (defensivo)', async () => {
      const { prisma, challenges, service } = build();
      challenges.verifyToken.mockResolvedValue('u1');
      prisma.user.findUnique.mockResolvedValue(null); // notYetVerified → u null
      prisma.user.update.mockResolvedValue(makeUser());
      const res = await service.passwordlessVerifyToken('tok', ctx);
      expect(res.status).toBe('ok');
    });
  });

  describe('googleLogin', () => {
    const profile = {
      email: 'g@x.com',
      firstName: 'G',
      lastName: 'Oogle',
      picture: 'http://p',
      providerAccountId: 'gid',
    };

    it('crea el usuario si no existe (llega verificado)', async () => {
      const { prisma, google, service } = build();
      google.verify.mockResolvedValue(profile);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(makeUser({ email: 'g@x.com' }));
      const res = await service.googleLogin('idtok', ctx);
      expect(res.status).toBe('ok');
      expect(prisma.user.create).toHaveBeenCalled();
      expect(prisma.oAuthAccount.upsert).toHaveBeenCalled();
    });

    it('verifica el correo de un usuario existente aún sin verificar', async () => {
      const { prisma, google, service } = build();
      google.verify.mockResolvedValue(profile);
      prisma.user.findUnique.mockResolvedValue(makeUser({ email: 'g@x.com', emailVerifiedAt: null }));
      prisma.user.update.mockResolvedValue(makeUser({ email: 'g@x.com' }));
      await service.googleLogin('idtok', ctx);
      expect(prisma.user.update).toHaveBeenCalled();
    });

    it('usuario existente ya verificado no se actualiza', async () => {
      const { prisma, google, service } = build();
      google.verify.mockResolvedValue(profile);
      prisma.user.findUnique.mockResolvedValue(makeUser({ email: 'g@x.com' }));
      await service.googleLogin('idtok', ctx);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  it('logout revoca el refresh token', async () => {
    const { tokens, service } = build();
    await service.logout('r');
    expect(tokens.revoke).toHaveBeenCalledWith('r');
  });

  describe('recuperación de contraseña', () => {
    it('forgotPassword: usuario inexistente no crea recovery', async () => {
      const { prisma, service } = build();
      prisma.user.findUnique.mockResolvedValue(null);
      await service.forgotPassword({ email: 'x@x.com' });
      expect(prisma.passwordRecovery.create).not.toHaveBeenCalled();
    });

    it('forgotPassword: usuario existente crea recovery y tolera fallo de correo', async () => {
      const { prisma, mail, service } = build();
      prisma.user.findUnique.mockResolvedValue(makeUser());
      mail.sendTemplated.mockRejectedValue(new Error('smtp caído')); // safeSend lo traga
      await expect(service.forgotPassword({ email: 'u1@x.com' })).resolves.toBeUndefined();
      expect(prisma.passwordRecovery.create).toHaveBeenCalled();
    });

    it('forgotPassword: sin origins configurados usa un enlace sin host', async () => {
      const { prisma, mail, service } = build();
      // Sobrescribe config.get para devolver undefined → la rama `?? []`/`?? ''`.
      (service as unknown as { config: { get: jest.Mock } }).config.get = jest.fn(() => undefined);
      prisma.user.findUnique.mockResolvedValue(makeUser());
      await service.forgotPassword({ email: 'u1@x.com' });
      expect(mail.sendTemplated).toHaveBeenCalled();
    });

    it('resetPassword: token inválido → 400', async () => {
      const { prisma, service } = build();
      prisma.passwordRecovery.findUnique.mockResolvedValue(null);
      await expect(service.resetPassword({ token: 't', password: 'x' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('resetPassword: token ya usado → 400', async () => {
      const { prisma, service } = build();
      prisma.passwordRecovery.findUnique.mockResolvedValue({
        id: 'pr1',
        userId: 'u1',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 10000),
      });
      await expect(service.resetPassword({ token: 't', password: 'x' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('resetPassword: token expirado → 400', async () => {
      const { prisma, service } = build();
      prisma.passwordRecovery.findUnique.mockResolvedValue({
        id: 'pr1',
        userId: 'u1',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.resetPassword({ token: 't', password: 'x' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('resetPassword: token válido cambia la contraseña y revoca sesiones', async () => {
      const { prisma, tokens, service } = build();
      prisma.passwordRecovery.findUnique.mockResolvedValue({
        id: 'pr1',
        userId: 'u1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 10000),
      });
      await service.resetPassword({ token: 't', password: 'nuevaClave' });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(tokens.revokeAllForUser).toHaveBeenCalledWith('u1');
    });
  });

  describe('changePassword', () => {
    it('contraseña actual incorrecta → 400', async () => {
      const { prisma, service } = build();
      prisma.user.findUnique.mockResolvedValue(makeUser());
      bcrypt.compare.mockResolvedValue(false);
      await expect(
        service.changePassword('u1', { currentPassword: 'mala', newPassword: 'nueva' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sin passwordHash (cuenta social) → 400', async () => {
      const { prisma, service } = build();
      prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash: null }));
      await expect(
        service.changePassword('u1', { currentPassword: 'x', newPassword: 'y' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('usuario inexistente → 400', async () => {
      const { prisma, service } = build();
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.changePassword('nope', { currentPassword: 'x', newPassword: 'y' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('contraseña actual correcta → actualiza y revoca sesiones', async () => {
      const { prisma, tokens, service } = build();
      prisma.user.findUnique.mockResolvedValue(makeUser());
      bcrypt.compare.mockResolvedValue(true);
      await service.changePassword('u1', { currentPassword: 'ok', newPassword: 'nueva' });
      expect(prisma.user.update).toHaveBeenCalled();
      expect(tokens.revokeAllForUser).toHaveBeenCalledWith('u1');
    });
  });

  describe('verifyTwoFactor (preauth inválida)', () => {
    it('token de preauth con tipo incorrecto → 401', async () => {
      const { jwt, service } = build();
      jwt.verify.mockReturnValue({ sub: 'u1', typ: 'access' }); // no es 2fa
      await expect(service.verifyTwoFactor('bad', '123456', ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('token de preauth que no verifica → 401', async () => {
      const { jwt, service } = build();
      jwt.verify.mockImplementation(() => {
        throw new Error('firma inválida');
      });
      await expect(service.verifyTwoFactor('bad', '123456', ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
