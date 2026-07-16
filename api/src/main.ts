// OTel primero: debe parchear los módulos antes de que Nest/Express/Prisma se
// carguen. Import con efecto de lado (arranca el tracing si está habilitado).
import './infra/observability/tracing';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const isProd = config.get<boolean>('isProd');

  // Logger estructurado (pino) como logger de Nest.
  app.useLogger(app.get(Logger));

  // Seguridad y transporte.
  // Ocultar la tecnología (v3.8): quitar el fingerprint `X-Powered-By: Express`
  // (helmet ya lo hace por defecto; explícito aquí como defensa en profundidad para
  // no regalar a un atacante el mapa exacto de versiones/CVEs). helmet añade además
  // CSP, HSTS, X-Frame-Options, nosniff, etc. La CSP por defecto convive con Swagger.
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  // `trust proxy`: hace que Express resuelva `req.ip` a la IP REAL del cliente detrás
  // de los proxies de GCP (Cloud Run/LB) en vez del último hop, y — configurado al
  // número correcto de proxies — evita que un cliente falsee su IP metiendo entradas
  // en X-Forwarded-For (base del rate-limit y del anti-abuso de reservas por IP).
  app.getHttpAdapter().getInstance().set('trust proxy', config.get('security.trustProxy') ?? false);
  app.use(helmet());
  app.use(compression());
  app.enableCors({
    origin: (origin, cb) => {
      const allowed = config.get<string[]>('cors.origins') ?? [];
      if (!origin || allowed.includes('*') || allowed.includes(origin) || !isProd) {
        return cb(null, true);
      }
      return cb(new Error('Not allowed by CORS'), false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  });

  // /api/v1/...
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Validación global de DTOs.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // Contrato de error uniforme.
  app.useGlobalFilters(new AllExceptionsFilter(!!isProd));

  app.enableShutdownHooks();

  // Swagger (no en prod).
  if (!isProd && process.env.DISABLE_SWAGGER !== 'true') {
    const doc = new DocumentBuilder()
      .setTitle('Boletiva API')
      .setDescription('API de la boletera Boletiva')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));
  }

  const port = config.get<number>('port') ?? 8080;
  await app.listen(port, '0.0.0.0');
  const logger = app.get(Logger);
  logger.log(`API lista en http://0.0.0.0:${port} (${config.get('env')})`, 'Bootstrap');
}

bootstrap();
