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
  if (!isProd) {
    const doc = new DocumentBuilder()
      .setTitle('Pasa Eventos API')
      .setDescription('API de la boletera Pasa Eventos')
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
