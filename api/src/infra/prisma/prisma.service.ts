import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Cliente Prisma gestionado por el ciclo de vida de Nest.
 * Fuente de verdad transaccional (PostgreSQL).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Conexión a PostgreSQL establecida');
    await this.ensureConstraints();
  }

  /**
   * Índices/constraints que Prisma no expresa en el schema (índices parciales).
   * Idempotente: se aplica en cada arranque y sobrevive a `prisma db push`.
   *
   * `order_items_active_seat_uniq`: garantía a nivel de motor de que un asiento
   * no puede estar en dos líneas ACTIVAS a la vez (belt-and-suspenders del
   * anti-doble-venta, además del SELECT ... FOR UPDATE del commit).
   */
  private async ensureConstraints(): Promise<void> {
    await this.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS order_items_active_seat_uniq
       ON order_items (seat_id)
       WHERE seat_id IS NOT NULL AND active = true`,
    );
    // Solo puede haber UNA tabla de comisiones activa a la vez.
    await this.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS fee_schedules_one_active
       ON fee_schedules (active)
       WHERE active = true`,
    );
    // Solo puede haber UNA pasarela default de plataforma.
    await this.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS payment_gateways_one_default
       ON payment_gateways (is_platform_default)
       WHERE is_platform_default = true`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Verificación de conectividad para el health-check. */
  async ping(): Promise<boolean> {
    await this.$queryRaw`SELECT 1`;
    return true;
  }
}
