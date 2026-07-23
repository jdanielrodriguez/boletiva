import { Injectable } from '@nestjs/common';
import { Device } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { sha256 } from '../../common/utils/crypto';

export interface DeviceContext {
  deviceId?: string;
  userAgent?: string;
  ip?: string;
}

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Identidad estable del dispositivo. Prioriza el id explícito (`deviceId` =
   * header X-Device-Id o cookie estable `device_id`). El fallback usa SOLO el
   * User-Agent: la IP se excluye a propósito por ser volátil (proxies, Cloud Run,
   * redes móviles) — incluirla hacía que el mismo navegador se viera como nuevo y
   * se pidiera 2FA en cada login.
   */
  hash(ctx: DeviceContext): string {
    return sha256(ctx.deviceId?.trim() || `ua:${ctx.userAgent ?? ''}`);
  }

  /**
   * ¿El contexto trae una identidad ESTABLE (header `X-Device-Id` o cookie `device_id`)?
   * El fallback por User-Agent NO cuenta: un UA es público y trivialmente reproducible,
   * así que un atacante con la contraseña + el mismo UA se saltaría el 2FA "confiando"
   * un dispositivo que nunca lo fue. Sin id estable → el dispositivo NO puede confiarse.
   */
  hasStableId(ctx: DeviceContext): boolean {
    return !!ctx.deviceId?.trim();
  }

  /** Registra/actualiza el dispositivo; indica si es nuevo (nunca visto). */
  async touch(userId: string, ctx: DeviceContext): Promise<{ device: Device; isNew: boolean }> {
    const deviceHash = this.hash(ctx);
    const existing = await this.prisma.device.findUnique({
      where: { userId_deviceHash: { userId, deviceHash } },
    });
    if (existing) {
      const device = await this.prisma.device.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date(), ip: ctx.ip, userAgent: ctx.userAgent },
      });
      return { device, isNew: false };
    }
    const device = await this.prisma.device.create({
      data: { userId, deviceHash, ip: ctx.ip, userAgent: ctx.userAgent },
    });
    return { device, isNew: true };
  }

  isTrusted(device: Device): boolean {
    return device.trustedAt != null;
  }

  /** ¿El dispositivo de este contexto ya estaba marcado confiable en BD? */
  async isKnownTrusted(userId: string, ctx: DeviceContext): Promise<boolean> {
    if (!this.hasStableId(ctx)) return false; // UA-only nunca cuenta como confiable
    const device = await this.prisma.device.findUnique({
      where: { userId_deviceHash: { userId, deviceHash: this.hash(ctx) } },
    });
    return device?.trustedAt != null;
  }

  /** Marca el dispositivo como confiable (tras pasar 2FA). Solo si hay id estable. */
  async trust(userId: string, ctx: DeviceContext): Promise<void> {
    const deviceHash = this.hash(ctx);
    if (!this.hasStableId(ctx)) {
      // Sin id estable: registramos el dispositivo (touch) pero NO lo confiamos, para no
      // crear una entrada "confiable" atada a un simple User-Agent reproducible.
      await this.touch(userId, ctx);
      return;
    }
    await this.prisma.device.upsert({
      where: { userId_deviceHash: { userId, deviceHash } },
      update: {
        trustedAt: new Date(),
        lastSeenAt: new Date(),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      create: { userId, deviceHash, trustedAt: new Date(), ip: ctx.ip, userAgent: ctx.userAgent },
    });
  }

  list(userId: string) {
    return this.prisma.device.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        ip: true,
        trustedAt: true,
        lastSeenAt: true,
        createdAt: true,
      },
    });
  }

  async revoke(userId: string, deviceId: string): Promise<void> {
    await this.prisma.device.deleteMany({ where: { id: deviceId, userId } });
  }
}
