import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Privacidad y retención de datos (Ola 6). Anonimiza (seudonimiza) la PII de un
 * usuario **preservando intacta la trazabilidad del ledger**: el `user.id` no
 * cambia (los asientos contables, órdenes y boletos siguen referenciándolo), pero
 * el correo, nombre, teléfono, avatar y credenciales se borran/ofuscan y se
 * eliminan dispositivos/tokens/OAuth. También se depura la PII de facturación
 * (nombre/dirección), conservando los campos fiscales (NIT/FEL).
 *
 * Dos disparadores (se eligió "ambas"): endpoint admin bajo demanda + job
 * programado (setInterval diario, activable por env; apagado en test) que anonimiza
 * a los usuarios cuyos eventos concluyeron hace más de `retention.days`.
 */
@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionService.name);
  private timer?: NodeJS.Timeout;
  private readonly enabled: boolean;
  private readonly days: number;

  constructor(private readonly prisma: PrismaService, config: ConfigService) {
    this.enabled = config.get<boolean>('retention.enabled') ?? false;
    this.days = config.get<number>('retention.days') ?? 365;
  }

  onModuleInit(): void {
    if (!this.enabled) return; // apagado en test y por defecto
    const DAY_MS = 24 * 3600 * 1000;
    this.timer = setInterval(() => {
      this.runRetention().catch((e) => this.logger.error(`Retención falló: ${e.message}`));
    }, DAY_MS);
    this.logger.log(`Job de retención activo (cada 24h, ${this.days} días)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private cutoff(days: number): Date {
    return new Date(Date.now() - days * 24 * 3600 * 1000);
  }

  /** Anonimiza a un usuario. Idempotente; no aplica a admins. */
  async anonymizeUser(userId: string): Promise<{ id: string; anonymized: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.roles.includes(Role.admin)) {
      throw new BadRequestException('No se puede anonimizar a un administrador');
    }
    if (user.anonymizedAt) return { id: userId, anonymized: true }; // ya anonimizado

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          email: `anon_${userId}@anonimizado.local`,
          firstName: 'Usuario anonimizado',
          lastName: null,
          phone: null,
          avatarUrl: null,
          passwordHash: null,
          totpSecret: null,
          totpPendingSecret: null,
          status: 'inactive',
          anonymizedAt: new Date(),
        },
      }),
      // PII de facturación en órdenes (se conservan NIT/FEL fiscales).
      this.prisma.order.updateMany({
        where: { buyerId: userId },
        data: { billingName: null, billingAddress: null },
      }),
      // Elimina rastros de acceso (no financieros).
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
      this.prisma.device.deleteMany({ where: { userId } }),
      this.prisma.oAuthAccount.deleteMany({ where: { userId } }),
      this.prisma.authChallenge.deleteMany({ where: { userId } }),
      this.prisma.passwordRecovery.deleteMany({ where: { userId } }),
    ]);
    this.logger.log(`Usuario ${userId} anonimizado (ledger preservado)`);
    return { id: userId, anonymized: true };
  }

  /** IDs de usuarios elegibles: no admin, no anonimizados, sin actividad ni eventos
   * (propios o comprados) que concluyan después del corte. */
  async eligibleUserIds(days: number): Promise<string[]> {
    const cutoff = this.cutoff(days);
    const users = await this.prisma.user.findMany({
      where: {
        anonymizedAt: null,
        NOT: { roles: { has: Role.admin } },
        OR: [{ lastLoginAt: null }, { lastLoginAt: { lt: cutoff } }],
        orders: { none: { event: { endsAt: { gte: cutoff } } } },
        events: { none: { endsAt: { gte: cutoff } } },
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  /** Ejecuta la retención: anonimiza a todos los elegibles. */
  async runRetention(daysOverride?: number): Promise<{ anonymized: number; days: number }> {
    const days = daysOverride ?? this.days;
    const ids = await this.eligibleUserIds(days);
    for (const id of ids) {
      await this.anonymizeUser(id).catch((e) =>
        this.logger.error(`No se pudo anonimizar ${id}: ${e.message}`),
      );
    }
    return { anonymized: ids.length, days };
  }
}
