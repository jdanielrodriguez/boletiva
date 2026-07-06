import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { HealthService } from './health.service';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

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
    res.status(report.status === 'ok' ? 200 : 503).json(report);
  }

  @Get()
  @ApiOperation({ summary: 'Health completo: PostgreSQL, Redis, RabbitMQ, storage y mail' })
  async full(@Res() res: Response) {
    const report = await this.health.check();
    res.status(report.status === 'ok' ? 200 : 503).json(report);
  }
}
