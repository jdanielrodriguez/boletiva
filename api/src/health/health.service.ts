import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import { RedisService } from '../infra/redis/redis.service';
import { MailService } from '../infra/mail/mail.service';
import { StorageService } from '../infra/storage/storage.service';
import { RabbitService } from '../infra/messaging/rabbit.service';
import {
  IntegrationsService,
  IntegrationService,
} from '../infra/integrations/integrations.service';

export interface CheckResult {
  ok: boolean;
  latencyMs: number;
  detail?: string;
}

export interface HealthReport {
  status: 'ok' | 'error';
  uptimeSeconds: number;
  timestamp: string;
  // Dependencias de infraestructura (postgres/redis/rabbit/storage/mail): su fallo
  // baja el status a 'error' (503).
  checks: Record<string, CheckResult>;
  // Integraciones externas configurables por env: true = credenciales presentes y
  // el servicio está levantado; false = sin configurar (se ignora). NO afecta el
  // status del health (una integración apagada es un estado válido, no un fallo).
  integrations: Record<IntegrationService, boolean>;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly storage: StorageService,
    private readonly rabbit: RabbitService,
    private readonly integrations: IntegrationsService,
  ) {}

  private async timed(fn: () => Promise<boolean>): Promise<CheckResult> {
    const start = Date.now();
    try {
      const ok = await fn();
      return { ok, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, detail: (err as Error).message };
    }
  }

  async check(): Promise<HealthReport> {
    const [postgres, redis, mail, storage, rabbitmq] = await Promise.all([
      this.timed(() => this.prisma.ping()),
      this.timed(() => this.redis.ping()),
      this.timed(() => this.mail.ping()),
      this.timed(() => this.storage.ping()),
      this.timed(() => this.rabbit.ping()),
    ]);

    const checks = { postgres, redis, mail, storage, rabbitmq };
    const status = Object.values(checks).every((c) => c.ok) ? 'ok' : 'error';

    return {
      status,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      checks,
      integrations: this.integrations.capabilities(),
    };
  }
}
