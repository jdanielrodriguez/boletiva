// OTel primero: debe parchear los módulos antes de que Nest/Express/Prisma se
// carguen. Import con efecto de lado (arranca el tracing si está habilitado).
import './infra/observability/tracing';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { assertProductionSecurity } from './common/security/assert-prod-security';

async function bootstrap(): Promise<void> {
  // Sanea las URLs de conexión ANTES de crear la app (Config/Prisma/Redis/Rabbit las
  // leen al instanciarse): quita espacios/saltos y un '%' final — el marcador de "sin
  // salto de línea" de zsh que a veces se cuela al copiar el valor a un secreto y que
  // hace explotar `new URL()` con ERR_INVALID_URL (tumbaba el arranque en Cloud Run).
  for (const key of ['DATABASE_URL', 'REDIS_URL', 'AMQP_URL']) {
    const v = process.env[key];
    if (v) process.env[key] = v.trim().replace(/%+$/, '');
  }

  // rawBody: necesario para verificar el webhook SVIX de Recurrente (la firma es sobre el
  // cuerpo CRUDO). No cambia el parseo normal; solo expone `req.rawBody` donde se pida.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  const config = app.get(ConfigService);
  const isProd = config.get<boolean>('isProd');

  // Logger estructurado (pino) como logger de Nest.
  app.useLogger(app.get(Logger));

  // Límite EXPLÍCITO de tamaño de cuerpo (QA): con rawBody global cada request se bufferea en
  // memoria; sin tope, un cuerpo enorme es un DoS de memoria. 1 MB cubre webhooks/JSON de la app
  // (las subidas de media van directas al storage por URL firmada, no por el body de la API).
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });

  // Fail-fast en PROD: secretos con default de dev, trust proxy mal parametrizado o
  // CORS '*' con credenciales → aborta el arranque (auditoría dual C1/C2/M5).
  assertProductionSecurity(config);

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
      // I-01: rechazo LIMPIO — no reflejamos las cabeceras CORS (el navegador bloquea
      // igual) en vez de lanzar un Error, que se propagaba como 500 y ensuciaba el
      // monitoreo / facilitaba fingerprinting. `cb(null, false)` = origen no permitido.
      return cb(null, false);
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

  // Contrato de error uniforme. El stack se expone SOLO si EXPOSE_ERROR_STACK=true
  // (variable dedicada, no NODE_ENV) → B-03.
  app.useGlobalFilters(
    new AllExceptionsFilter(!!isProd, !!config.get<boolean>('exposeErrorStack')),
  );

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
