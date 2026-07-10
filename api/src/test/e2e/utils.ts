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

/**
 * Login que resuelve el 2FA automáticamente (método email, leyendo MailHog).
 * Dispositivo estable por email: la primera vez pasa 2FA y queda confiable;
 * las siguientes entran directo. Devuelve el access token.
 */
export async function login(
  app: INestApplication,
  email: string,
  password = 'Password123',
): Promise<string> {
  const device = `test-device-${email}`;
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('X-Device-Id', device)
    .send({ email, password })
    .expect(200);
  if (res.body.status === 'ok') return res.body.tokens.accessToken;

  const code = await lastEmailCode(email);
  const done = await request(app.getHttpServer())
    .post('/api/v1/auth/2fa/verify')
    .set('X-Device-Id', device)
    .send({ preauthToken: res.body.preauthToken, code })
    .expect(200);
  return done.body.tokens.accessToken;
}

export const SEED = {
  admin: 'admin@pasaeventos.com',
  promoter: 'promotor@pasaeventos.com',
  buyer: 'cliente@pasaeventos.com',
};

// ---- Helpers de correo (MailHog) para probar códigos/enlaces ----
import axios from 'axios';

const MAILHOG = process.env.MAILHOG_URL ?? 'http://pasaeventos_mailhog:8025';

/** Borra todos los correos capturados (llamar antes de disparar un envío). */
export async function clearMail(): Promise<void> {
  await axios.delete(`${MAILHOG}/api/v1/messages`).catch(() => undefined);
}

/** Devuelve el correo (subject + body decodificado) más reciente enviado a `email`. */
export async function lastEmailFor(
  email: string,
): Promise<{ subject: string; body: string }> {
  for (let i = 0; i < 12; i++) {
    const { data } = await axios.get(`${MAILHOG}/api/v2/messages`);
    for (const m of data.items ?? []) {
      const to = (m.Content?.Headers?.To ?? []).join(',');
      if (to.includes(email)) {
        const subject = (m.Content?.Headers?.Subject ?? []).join(' ');
        const body = String(m.Content?.Body ?? '').replace(/=\r?\n/g, '').replace(/=3D/g, '=');
        return { subject, body };
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No llegó correo para ${email}`);
}

/** Devuelve el código de 6 dígitos del correo más reciente enviado a `email`. */
export async function lastEmailCode(email: string): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const { data } = await axios.get(`${MAILHOG}/api/v2/messages`);
    for (const m of data.items ?? []) {
      const to = (m.Content?.Headers?.To ?? []).join(',');
      if (to.includes(email)) {
        const body = String(m.Content?.Body ?? '').replace(/=\r?\n/g, '');
        const match = body.match(/\b(\d{6})\b/);
        if (match) return match[1];
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No se encontró código para ${email}`);
}
