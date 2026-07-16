import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Cliente Redis (ioredis). Usado para locks de asiento, caché, rate-limit,
 * contadores y (más adelante) BullMQ.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const url = this.config.getOrThrow<string>('redis.url');
    this.client = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });
    this.client.on('error', (err) => this.logger.error(`Redis error: ${err.message}`));
    this.client.on('ready', () => this.logger.log('Conexión a Redis lista'));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }

  getClient(): Redis {
    return this.client;
  }

  /** Verificación de conectividad para el health-check. */
  async ping(): Promise<boolean> {
    const res = await this.client.ping();
    return res === 'PONG';
  }

  /**
   * Lock distribuido best-effort (SET NX PX). Devuelve true si ESTA instancia lo tomó.
   * Úsalo para que jobs periódicos (sweeper/retención) corran en UNA sola instancia de
   * Cloud Run por tick, no en las N. Fail-open ante fallo de Redis (deja correr) para no
   * bloquear la única instancia cuando Redis parpadea. El lock caduca solo (px).
   */
  async tryLock(key: string, ttlMs: number): Promise<boolean> {
    try {
      const res = await this.client.set(`lock:${key}`, '1', 'PX', ttlMs, 'NX');
      return res === 'OK';
    } catch {
      return true; // fail-open: mejor correr una vez de más que no correr nunca
    }
  }
}
