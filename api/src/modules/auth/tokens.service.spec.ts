import { UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { TokensService } from './tokens.service';

/**
 * Cobertura de RAMAS de TokensService: emisión, rotación (inválido / reuso /
 * expirado / feliz), revocación (con y sin token) y revocación total. Prisma/JWT/
 * Config mockeados.
 */
describe('TokensService (rotación y revocación, unit)', () => {
  const build = () => {
    const prisma = {
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const jwt = { sign: jest.fn().mockReturnValue('access-token') };
    const config = {
      getOrThrow: jest.fn((k: string) => {
        if (k === 'jwt.accessTtl') return 900;
        if (k === 'jwt.refreshTtl') return 3600;
        if (k === 'jwt.accessSecret') return 'secret';
        return undefined;
      }),
    };
    const service = new TokensService(prisma as never, jwt as never, config as never);
    return { prisma, jwt, service };
  };

  const user = { id: 'u1', email: 'u1@x.com', roles: [Role.buyer] };

  it('issuePair emite un access + refresh nuevo', async () => {
    const { service } = build();
    const pair = await service.issuePair(user, { ip: '1.2.3.4', userAgent: 'jest' });
    expect(pair.accessToken).toBe('access-token');
    expect(pair.refreshToken).toMatch(/^[a-f0-9]+$/);
    expect(pair.expiresIn).toBe(900);
  });

  it('issuePair funciona sin metadatos de sesión (default)', async () => {
    const { service } = build();
    const pair = await service.issuePair(user);
    expect(pair.accessToken).toBe('access-token');
  });

  it('rotate con token desconocido → 401', async () => {
    const { prisma, service } = build();
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    await expect(service.rotate('nope')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rotate detecta reuso de un token revocado y revoca la familia → 401', async () => {
    const { prisma, service } = build();
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt1',
      family: 'fam',
      revokedAt: new Date(), // ya revocado → reuso
      expiresAt: new Date(Date.now() + 10000),
      user,
    });
    await expect(service.rotate('reused')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { family: 'fam', revokedAt: null } }),
    );
  });

  it('rotate con token expirado → 401', async () => {
    const { prisma, service } = build();
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt1',
      family: 'fam',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000), // expirado
      user,
    });
    await expect(service.rotate('old')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rotate feliz emite un par nuevo y revoca el anterior', async () => {
    const { prisma, service } = build();
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt1',
      family: 'fam',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 100000),
      user,
    });
    const pair = await service.rotate('valid');
    expect(pair.accessToken).toBe('access-token');
    expect(prisma.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'rt1' }, data: { revokedAt: expect.any(Date) } }),
    );
  });

  it('revoke con token desconocido no hace nada', async () => {
    const { prisma, service } = build();
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    await service.revoke('nope');
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('revoke con token conocido revoca su familia', async () => {
    const { prisma, service } = build();
    prisma.refreshToken.findUnique.mockResolvedValue({ id: 'rt1', family: 'fam' });
    await service.revoke('known');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { family: 'fam', revokedAt: null } }),
    );
  });

  it('revokeAllForUser revoca todas las sesiones activas', async () => {
    const { prisma, service } = build();
    await service.revokeAllForUser('u1');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }),
    );
  });
});
