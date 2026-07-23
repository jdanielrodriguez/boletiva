import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LedgerAccountType, Role } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** Opciones de anonimización manual: actor (no-repudio) + `force` para saltar salvaguardas. */
export interface AnonymizeOpts {
  force?: boolean;
  actorId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}
import { RedisService } from '../../infra/redis/redis.service';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('retention.enabled') ?? false;
    this.days = config.get<number>('retention.days') ?? 365;
  }

  onModuleInit(): void {
    if (!this.enabled) return; // apagado en test y por defecto
    const DAY_MS = 24 * 3600 * 1000;
    this.timer = setInterval(() => {
      // M1: lock distribuido (10 min) → una sola instancia de Cloud Run anonimiza por día.
      void this.redis.tryLock('retention', 10 * 60 * 1000).then((got) => {
        if (!got) return;
        return this.runRetention().catch((e) => this.logger.error(`Retención falló: ${e.message}`));
      });
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
  async anonymizeUser(userId: string, opts: AnonymizeOpts = {}): Promise<{ id: string; anonymized: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.roles.includes(Role.admin)) {
      throw new BadRequestException('No se puede anonimizar a un administrador');
    }
    if (user.anonymizedAt) return { id: userId, anonymized: true }; // ya anonimizado

    // Salvaguardas (QA): la anonimización es IRREVERSIBLE. Salvo `force` explícito, se RECHAZA
    // si el usuario tiene saldo>0 (dinero recuperable que perdería) o eventos FUTUROS (propios o
    // comprados). El job automático pre-filtra en eligibleUserIds y pasa force:true.
    if (!opts.force) {
      const now = new Date();
      const [wallet, futureOwned, futureBought] = await Promise.all([
        this.prisma.ledgerAccount.findUnique({
          where: { type_ownerId_currency: { type: LedgerAccountType.user_wallet, ownerId: userId, currency: 'GTQ' } },
          select: { balance: true },
        }),
        this.prisma.event.count({ where: { promoterId: userId, endsAt: { gte: now } } }),
        this.prisma.order.count({ where: { buyerId: userId, event: { endsAt: { gte: now } } } }),
      ]);
      if (wallet && wallet.balance.gt(0)) {
        throw new BadRequestException('El usuario tiene saldo en su billetera; retíralo o usa force para anonimizar');
      }
      if (futureOwned > 0 || futureBought > 0) {
        throw new BadRequestException('El usuario tiene eventos futuros (propios o comprados); usa force para anonimizar');
      }
    }

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
    // No-repudio (QA): acción irreversible sobre PII → queda en la bitácora hash-chain con el
    // actor (admin) o 'system' (job), IP/UA y si fue forzada. Best-effort: no revierte el trabajo.
    await this.audit
      .record({
        userId: opts.actorId ?? null,
        action: 'admin.user.anonymize',
        resource: `user:${userId}`,
        ip: opts.ip ?? null,
        userAgent: opts.userAgent ?? null,
        payload: { forced: opts.force === true, source: opts.actorId ? 'manual' : 'job' },
      })
      .catch((e) => this.logger.warn(`audit anonymize ${userId}: ${(e as Error).message}`));
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
    const ids = users.map((u) => u.id);
    if (!ids.length) return [];
    // Excluye a los que tengan saldo en billetera (dinero recuperable) — no elegibles.
    const funded = await this.prisma.ledgerAccount.findMany({
      where: { type: LedgerAccountType.user_wallet, ownerId: { in: ids }, balance: { gt: 0 } },
      select: { ownerId: true },
    });
    const fundedSet = new Set(funded.map((f) => f.ownerId));
    return ids.filter((id) => !fundedSet.has(id));
  }

  /** Ejecuta la retención: anonimiza a todos los elegibles. */
  async runRetention(daysOverride?: number): Promise<{ anonymized: number; days: number }> {
    const days = daysOverride ?? this.days;
    const ids = await this.eligibleUserIds(days);
    for (const id of ids) {
      // force:true — eligibleUserIds ya excluyó saldo>0 y eventos futuros; el actor es el job.
      await this.anonymizeUser(id, { force: true }).catch((e) =>
        this.logger.error(`No se pudo anonimizar ${id}: ${e.message}`),
      );
    }
    return { anonymized: ids.length, days };
  }
}
