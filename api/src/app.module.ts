import { randomUUID } from 'crypto';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'http';
import { configuration } from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './infra/prisma/prisma.module';
import { CryptoModule } from './infra/crypto/crypto.module';
import { RedisModule } from './infra/redis/redis.module';
import { MailModule } from './infra/mail/mail.module';
import { StorageModule } from './infra/storage/storage.module';
import { RabbitModule } from './infra/messaging/rabbit.module';
import { HealthModule } from './health/health.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { VerifiedEmailGuard } from './modules/auth/guards/verified-email.guard';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { EventsModule } from './modules/events/events.module';
import { VenuesModule } from './modules/venues/venues.module';
import { MediaModule } from './modules/media/media.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OrdersModule } from './modules/orders/orders.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { WalletModule } from './modules/wallet/wallet.module';

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
    CryptoModule,
    RedisModule,
    MailModule,
    StorageModule,
    RabbitModule,
    HealthModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    EventsModule,
    VenuesModule,
    MediaModule,
    InventoryModule,
    OrdersModule,
    LedgerModule,
    PaymentsModule,
    WalletModule,
  ],
  providers: [
    // Orden importa: autentica (JWT) → autoriza por rol → exige correo verificado.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: VerifiedEmailGuard },
  ],
})
export class AppModule {}
