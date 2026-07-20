import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Cliente Prisma gestionado por el ciclo de vida de Nest.
 * Fuente de verdad transaccional (PostgreSQL).
 *
 * Prisma 7 eliminó `datasource.url` del schema y el motor Rust: el cliente se
 * conecta vía DRIVER ADAPTER (`@prisma/adapter-pg` sobre `pg.Pool`). El `max` del
 * pool se dimensiona holgado (25 por defecto, override `PG_POOL_MAX`) para que la
 * concurrencia del on-sale (holds + commit con FOR UPDATE + advisory-lock del
 * ledger) no agote conexiones — se mantiene la regla de leer parámetros ANTES de
 * abrir la transacción para no reservar dos conexiones a la vez (anti-deadlock).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        max: Number(process.env.PG_POOL_MAX ?? 25),
      }),
    });
  }

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
    // Solo puede haber UNA transferencia pendiente por boleto a la vez.
    await this.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS ticket_transfers_one_pending
       ON ticket_transfers (ticket_id)
       WHERE status = 'pending'`,
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
