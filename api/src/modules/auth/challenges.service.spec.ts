import { BadRequestException } from '@nestjs/common';
import { ChallengesService } from './challenges.service';
import { sha256 } from '../../common/utils/crypto';

/**
 * Cobertura de RAMAS de ChallengesService: emisión (con tolerancia a fallo de
 * correo), verificación por código (inexistente / máx intentos / código errado con
 * incremento / éxito) y por token (magic link inválido / éxito). Prisma/Mail/Config
 * mockeados.
 */
describe('ChallengesService (retos OTP + magic link, unit)', () => {
  const build = () => {
    const prisma = {
      authChallenge: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { findUnique: jest.fn() },
    };
    const mail = { send: jest.fn().mockResolvedValue(undefined), sendTemplated: jest.fn().mockResolvedValue(undefined) };
    const config = { get: jest.fn(() => ['http://front.local']) };
    const service = new ChallengesService(prisma as never, mail as never, config as never);
    return { prisma, mail, service };
  };

  describe('issue', () => {
    it('invalida retos previos, crea uno nuevo y envía correo (con magic link)', async () => {
      const { prisma, mail, service } = build();
      await service.issue('u1', 'u1@x.com', 'email_verify', { withMagicLink: true });
      expect(prisma.authChallenge.updateMany).toHaveBeenCalled();
      expect(prisma.authChallenge.create).toHaveBeenCalled();
      expect(mail.sendTemplated).toHaveBeenCalled();
    });

    it('tolera un fallo de envío de correo (no lanza)', async () => {
      const { mail, service } = build();
      mail.sendTemplated.mockRejectedValue(new Error('smtp caído'));
      await expect(service.issue('u1', 'u1@x.com', 'passwordless')).resolves.toBeUndefined();
    });

    it('sin origins configurados usa cadena vacía (magic link sin host)', async () => {
      const prisma = {
        authChallenge: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          create: jest.fn().mockResolvedValue({}),
          findFirst: jest.fn(),
          update: jest.fn(),
        },
        user: { findUnique: jest.fn() },
      };
      const mail = { send: jest.fn().mockResolvedValue(undefined), sendTemplated: jest.fn().mockResolvedValue(undefined) };
      const config = { get: jest.fn(() => undefined) }; // cors.origins ausente → ?? [] y ?? ''
      const service = new ChallengesService(prisma as never, mail as never, config as never);
      await service.issue('u1', 'u1@x.com', 'email_verify', { withMagicLink: true });
      expect(mail.sendTemplated).toHaveBeenCalled();
    });
  });

  describe('consumeByCode', () => {
    it('sin reto vigente → 400', async () => {
      const { prisma, service } = build();
      prisma.authChallenge.findFirst.mockResolvedValue(null);
      await expect(service.consumeByCode('u1', 'twofa_email', '123456')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('demasiados intentos → 400', async () => {
      const { prisma, service } = build();
      prisma.authChallenge.findFirst.mockResolvedValue({ id: 'c1', attempts: 5, codeHash: sha256('123456') });
      await expect(service.consumeByCode('u1', 'twofa_email', '123456')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('código errado incrementa intentos y lanza 400', async () => {
      const { prisma, service } = build();
      prisma.authChallenge.findFirst.mockResolvedValue({ id: 'c1', attempts: 0, codeHash: sha256('right') });
      await expect(service.consumeByCode('u1', 'twofa_email', 'wrong')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.authChallenge.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { attempts: { increment: 1 } } }),
      );
    });

    it('código correcto consume el reto y devuelve el userId', async () => {
      const { prisma, service } = build();
      prisma.authChallenge.findFirst.mockResolvedValue({ id: 'c1', attempts: 0, codeHash: sha256('123456') });
      const uid = await service.consumeByCode('u1', 'twofa_email', '123456');
      expect(uid).toBe('u1');
      expect(prisma.authChallenge.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { consumedAt: expect.any(Date) } }),
      );
    });
  });

  describe('verifyCode', () => {
    it('correo desconocido → 400 (no revela existencia)', async () => {
      const { prisma, service } = build();
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.verifyCode('x@x.com', 'email_verify', '123456')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('correo conocido delega en consumeByCode', async () => {
      const { prisma, service } = build();
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.authChallenge.findFirst.mockResolvedValue({ id: 'c1', attempts: 0, codeHash: sha256('123456') });
      await expect(service.verifyCode('u1@x.com', 'email_verify', '123456')).resolves.toBe('u1');
    });
  });

  describe('verifyToken', () => {
    it('token inválido/expirado → 400', async () => {
      const { prisma, service } = build();
      prisma.authChallenge.findFirst.mockResolvedValue(null);
      await expect(service.verifyToken('passwordless', 'tok')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('token válido consume el reto y devuelve el userId', async () => {
      const { prisma, service } = build();
      prisma.authChallenge.findFirst.mockResolvedValue({ id: 'c1', userId: 'u9' });
      const uid = await service.verifyToken('passwordless', 'tok');
      expect(uid).toBe('u9');
      expect(prisma.authChallenge.update).toHaveBeenCalled();
    });
  });
});
