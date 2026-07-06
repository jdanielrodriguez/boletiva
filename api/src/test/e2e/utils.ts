import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';

/** Crea la app Nest para e2e con la misma configuración de bootstrap que main.ts. */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter(false));
  await app.init();
  return app;
}

/** Login con credenciales del seed; devuelve el access token. */
export async function login(
  app: INestApplication,
  email: string,
  password = 'Password123',
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body.tokens.accessToken;
}

export const SEED = {
  admin: 'admin@pasaeventos.com',
  promoter: 'promotor@pasaeventos.com',
  buyer: 'cliente@pasaeventos.com',
};
