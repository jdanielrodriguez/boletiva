import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

@Injectable()
export class TokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private signAccess(user: Pick<User, 'id' | 'email' | 'roles'>): { token: string; ttl: number } {
    const ttl = this.config.getOrThrow<number>('jwt.accessTtl');
    const token = this.jwt.sign(
      { sub: user.id, email: user.email, roles: user.roles },
      { secret: this.config.getOrThrow<string>('jwt.accessSecret'), expiresIn: ttl },
    );
    return { token, ttl };
  }

  private async persistRefresh(userId: string, family: string, meta: SessionMeta): Promise<string> {
    const raw = randomBytes(48).toString('hex');
    const ttl = this.config.getOrThrow<number>('jwt.refreshTtl');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        family,
        tokenHash: this.hash(raw),
        userAgent: meta.userAgent,
        ip: meta.ip,
        expiresAt: new Date(Date.now() + ttl * 1000),
      },
    });
    return raw;
  }

  /** Emite un par nuevo (nueva familia) al iniciar sesión / registrarse. */
  async issuePair(
    user: Pick<User, 'id' | 'email' | 'roles'>,
    meta: SessionMeta = {},
  ): Promise<TokenPair> {
    const access = this.signAccess(user);
    const refreshToken = await this.persistRefresh(user.id, randomUUID(), meta);
    return { accessToken: access.token, refreshToken, expiresIn: access.ttl };
  }

  /** Rota el refresh token; detecta reuso y revoca la familia completa si ocurre. */
  async rotate(refreshToken: string, meta: SessionMeta = {}): Promise<TokenPair> {
    const tokenHash = this.hash(refreshToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!existing) throw new UnauthorizedException('Refresh token inválido');

    // Reuso de un token ya revocado => posible robo: se revoca toda la familia.
    if (existing.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { family: existing.family, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reutilizado; sesión revocada');
    }
    if (existing.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expirado');
    }

    const user = existing.user;
    const access = this.signAccess(user);
    const newRaw = await this.persistRefresh(user.id, existing.family, meta);
    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    return { accessToken: access.token, refreshToken: newRaw, expiresIn: access.ttl };
  }

  /** Cierra la sesión: revoca la familia del refresh token dado. */
  async revoke(refreshToken: string): Promise<void> {
    const tokenHash = this.hash(refreshToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!existing) return;
    await this.prisma.refreshToken.updateMany({
      where: { family: existing.family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revoca todas las sesiones activas de un usuario. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
