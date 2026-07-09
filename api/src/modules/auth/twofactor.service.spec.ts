import { BadRequestException, NotFoundException } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { TwoFactorService } from './twofactor.service';

jest.mock('qrcode', () => ({ toDataURL: jest.fn() }));

/**
 * Cobertura de RAMAS de TwoFactorService: alta de TOTP (sin pendiente / código
 * inválido / éxito), vuelta al método email, y verificación del segundo factor
 * (TOTP inválido / sin secreto / válido / método email). authenticator (otplib)
 * espiado; Prisma/Encryption/Challenges mockeados.
 */
describe('TwoFactorService (2FA, unit)', () => {
  const build = () => {
    const prisma = { user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) } };
    const challenges = { issue: jest.fn(), consumeByCode: jest.fn() };
    const encryption = {
      encrypt: jest.fn((s: string) => `enc:${s}`),
      decrypt: jest.fn((s: string) => s.replace(/^enc:/, '')),
    };
    const service = new TwoFactorService(prisma as never, challenges as never, encryption as never);
    return { prisma, challenges, encryption, service };
  };

  afterEach(() => jest.restoreAllMocks());

  describe('setupTotp', () => {
    it('usuario inexistente → 404', async () => {
      const { prisma, service } = build();
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.setupTotp('u1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('genera secreto pendiente cifrado + otpauth + QR', async () => {
      const { prisma, encryption, service } = build();
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'u1@x.com' });
      jest.spyOn(authenticator, 'generateSecret').mockReturnValue('SECRET');
      jest.spyOn(authenticator, 'keyuri').mockReturnValue('otpauth://totp/x');
      (QRCode.toDataURL as jest.Mock).mockResolvedValue('data:image/png;base64,xxx');
      const res = await service.setupTotp('u1');
      expect(res.secret).toBe('SECRET');
      expect(res.otpauthUrl).toBe('otpauth://totp/x');
      expect(res.qrDataUrl).toContain('data:image');
      expect(encryption.encrypt).toHaveBeenCalledWith('SECRET');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { totpPendingSecret: 'enc:SECRET' } }),
      );
    });
  });

  describe('enableTotp', () => {
    it('sin configuración pendiente → 400', async () => {
      const { prisma, service } = build();
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', totpPendingSecret: null });
      await expect(service.enableTotp('u1', '123456')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('usuario inexistente → 400', async () => {
      const { prisma, service } = build();
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.enableTotp('u1', '123456')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('código inválido → 400', async () => {
      const { prisma, service } = build();
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', totpPendingSecret: 'enc:S' });
      jest.spyOn(authenticator, 'verify').mockReturnValue(false);
      await expect(service.enableTotp('u1', '000000')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('código válido → activa TOTP', async () => {
      const { prisma, service } = build();
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', totpPendingSecret: 'enc:S' });
      jest.spyOn(authenticator, 'verify').mockReturnValue(true);
      await service.enableTotp('u1', '123456');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ twoFactorMethod: 'totp', totpPendingSecret: null }),
        }),
      );
    });
  });

  it('useEmailMethod vuelve al 2FA por correo', async () => {
    const { prisma, service } = build();
    await service.useEmailMethod('u1');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ twoFactorMethod: 'email', totpSecret: null }),
      }),
    );
  });

  describe('verify', () => {
    it('TOTP con código inválido → 400', async () => {
      const { service } = build();
      jest.spyOn(authenticator, 'verify').mockReturnValue(false);
      await expect(
        service.verify({ twoFactorMethod: 'totp', totpSecret: 'enc:S' } as never, '000000'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('TOTP sin secreto configurado → 400', async () => {
      const { service } = build();
      await expect(
        service.verify({ twoFactorMethod: 'totp', totpSecret: null } as never, '123456'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('TOTP con código válido pasa', async () => {
      const { service } = build();
      jest.spyOn(authenticator, 'verify').mockReturnValue(true);
      await expect(
        service.verify({ twoFactorMethod: 'totp', totpSecret: 'enc:S' } as never, '123456'),
      ).resolves.toBeUndefined();
    });

    it('método email delega en el reto twofa_email', async () => {
      const { challenges, service } = build();
      await service.verify({ id: 'u1', twoFactorMethod: 'email' } as never, '123456');
      expect(challenges.consumeByCode).toHaveBeenCalledWith('u1', 'twofa_email', '123456');
    });
  });

  describe('startChallenge', () => {
    it('email → emite el reto; totp → no envía nada', async () => {
      const { challenges, service } = build();
      await service.startChallenge({ id: 'u1', email: 'u1@x.com', twoFactorMethod: 'email' } as never);
      expect(challenges.issue).toHaveBeenCalledWith('u1', 'u1@x.com', 'twofa_email');
      challenges.issue.mockClear();
      await service.startChallenge({ id: 'u2', email: 'u2@x.com', twoFactorMethod: 'totp' } as never);
      expect(challenges.issue).not.toHaveBeenCalled();
    });
  });
});
