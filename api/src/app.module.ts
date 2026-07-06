import { randomUUID } from 'crypto';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'http';
import { configuration } from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './infra/prisma/prisma.module';
import { RedisModule } from './infra/redis/redis.module';
import { MailModule } from './infra/mail/mail.module';
import { StorageModule } from './infra/storage/storage.module';
import { RabbitModule } from './infra/messaging/rabbit.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProd = config.get<boolean>('isProd');
        return {
          // Formato de wildcard de Express 5 (path-to-regexp v8) para el
          // middleware de logging: evita el warning "Unsupported route path".
          forRoutes: ['{*path}'],
          pinoHttp: {
            level: isProd ? 'info' : 'debug',
            genReqId: (req: IncomingMessage, res: ServerResponse) => {
              const existing = (req.headers['x-request-id'] as string) || randomUUID();
              res.setHeader('X-Request-Id', existing);
              return existing;
            },
            transport: isProd
              ? undefined
              : { target: 'pino-pretty', options: { singleLine: true } },
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            customProps: () => ({ context: 'HTTP' }),
          },
        };
      },
    }),
    PrismaModule,
    RedisModule,
    MailModule,
    StorageModule,
    RabbitModule,
    HealthModule,
  ],
})
export class AppModule {}
