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
import { IntegrationsModule } from './infra/integrations/integrations.module';
import { RedisModule } from './infra/redis/redis.module';
import { QueueModule } from './infra/queue/queue.module';
import { MailModule } from './infra/mail/mail.module';
import { StorageModule } from './infra/storage/storage.module';
import { RabbitModule } from './infra/messaging/rabbit.module';
import { HealthModule } from './health/health.module';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard';
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
import { ReservationsModule } from './modules/reservations/reservations.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { PaymentGatewaysModule } from './modules/payment-gateways/payment-gateways.module';
import { CostShareModule } from './modules/cost-share/cost-share.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { ValidatorsModule } from './modules/validators/validators.module';
import { PromotersModule } from './modules/promoters/promoters.module';
import { PaymentMethodsModule } from './modules/payment-methods/payment-methods.module';
import { RetentionModule } from './modules/retention/retention.module';
import { StreamModule } from './modules/stream/stream.module';
import { BannerModule } from './modules/banner/banner.module';
import { HallsModule } from './modules/halls/halls.module';
import { SeatTemplatesModule } from './modules/seat-templates/seat-templates.module';
import { SettingsModule } from './modules/settings/settings.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { MaintenanceGuard } from './modules/maintenance/maintenance.guard';
import { AuditModule } from './modules/audit/audit.module';
import { AdminModule } from './modules/admin/admin.module';
import { FelModule } from './modules/fel/fel.module';
import { AdvisorModule } from './modules/advisor/advisor.module';
import { AdvisorUnlockGuard } from './modules/advisor/advisor-unlock.guard';
import { SupportModule } from './modules/support/support.module';
import { KbModule } from './modules/kb/kb.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AdvisorsModule } from './modules/advisors/advisors.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
      // En test IGNORA el archivo `.env`: las vars de infra ya vienen inyectadas por
      // el `env_file` de docker a process.env, y `jest.env.ts` neutraliza las
      // credenciales de integración ANTES del boot. Sin esto, dotenv re-leería el
      // `.env` del desarrollador y repoblaría las llaves reales → tests no-herméticos.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
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
            // No filtrar credenciales/tokens ni PII sensible a los logs (B1).
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-webhook-signature"]',
              'res.headers["set-cookie"]',
              'req.body.password',
              'req.body.currentPassword',
              'req.body.newPassword',
              'req.body.code',
              'req.body.refreshToken',
              'req.body.preauthToken',
              'req.body.token',
              'req.query.access_token',
            ],
            customProps: () => ({ context: 'HTTP' }),
          },
        };
      },
    }),
    PrismaModule,
    CryptoModule,
    IntegrationsModule,
    RedisModule,
    RateLimitModule,
    QueueModule,
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
    ReservationsModule,
    LedgerModule,
    PaymentsModule,
    WalletModule,
    PaymentGatewaysModule,
    CostShareModule,
    TicketsModule,
    ValidatorsModule,
    PromotersModule,
    PaymentMethodsModule,
    RetentionModule,
    StreamModule,
    BannerModule,
    HallsModule,
    SeatTemplatesModule,
    SettingsModule,
    MaintenanceModule,
    AuditModule,
    AdminModule,
    FelModule,
    AdvisorModule,
    SupportModule,
    KbModule,
    NotificationsModule,
    AdvisorsModule,
  ],
  providers: [
    // Orden importa: rate-limit por IP PRIMERO (frena floods antes de autenticar) →
    // autentica (JWT) → corta si hay mantenimiento (503, salvo admin o rutas
    // allowlisted) → autoriza por rol → exige correo verificado.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: MaintenanceGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // B2: tras autorizar por rol, si el actor es ASESOR exige ventana de desbloqueo
    // para mutar en área admin (salvo advisor.lock_enabled=false).
    { provide: APP_GUARD, useClass: AdvisorUnlockGuard },
    { provide: APP_GUARD, useClass: VerifiedEmailGuard },
  ],
})
export class AppModule {}
