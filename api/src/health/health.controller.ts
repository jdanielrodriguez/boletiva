import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { HealthService, type HealthReport } from './health.service';
import { Public } from '../common/decorators/public.decorator';
import { AllowDuringMaintenance } from '../common/decorators/maintenance.decorator';
import { SkipRateLimit } from '../common/rate-limit/rate-limit.decorator';

@ApiTags('health')
@Public()
@AllowDuringMaintenance()
@SkipRateLimit()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * En PROD no exponemos la topología (checks por componente + integraciones activas)
   * a un anónimo: es valor de reconocimiento (H-07). El probe solo necesita el código
   * de estado; fuera de prod devolvemos el detalle completo para depurar.
   */
  private expose(report: HealthReport): Pick<HealthReport, 'status' | 'timestamp'> | HealthReport {
    if (this.config.get<boolean>('isProd')) {
      return { status: report.status, timestamp: report.timestamp };
    }
    return report;
  }

  @Get('live')
  @HttpCode(200)
  @ApiOperation({ summary: 'Liveness probe (siempre 200 si el proceso vive)' })
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe (503 si alguna dependencia falla)' })
  async ready(@Res() res: Response) {
    const report = await this.health.check();
    res.status(report.status === 'ok' ? 200 : 503).json(this.expose(report));
  }

  @Get()
  @ApiOperation({ summary: 'Health completo: PostgreSQL, Redis, RabbitMQ, storage y mail (detalle solo fuera de prod)' })
  async full(@Res() res: Response) {
    const report = await this.health.check();
    res.status(report.status === 'ok' ? 200 : 503).json(this.expose(report));
  }
}
