/**
 * Configuración tipada derivada del entorno ya validado (env.validation.ts).
 * Se carga con ConfigModule.load y se consume vía ConfigService.
 */
export interface AppConfig {
  env: 'development' | 'production' | 'test';
  isProd: boolean;
  isDev: boolean;
  isTest: boolean;
  port: number;
  appName: string;
  database: { url: string };
  redis: { url: string };
  amqp: { url: string; inline: boolean };
  storage: {
    provider: 's3' | 'gcs';
    s3: {
      endpoint: string;
      publicEndpoint?: string;
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle: boolean;
    };
    gcs: { projectId: string; bucket: string; serviceAccountJson: string };
  };
  mail: { host: string; port: number; user: string; pass: string; secure: boolean; from: string };
  jwt: { accessSecret: string; accessTtl: number; refreshSecret: string; refreshTtl: number };
  security: { encryptionKey: string };
  oauth: { google: { clientId: string } };
  payment: {
    provider: string;
    webhookSecret: string;
    // Simulador: auto-confirma el pago tras un jitter aleatorio (dev/staging), para
    // ejercitar el estado `pending` en el frontend. OFF en test (webhooks manuales).
    simulatorAutoConfirm: boolean;
    simulatorJitterMinMs: number;
    simulatorJitterMaxMs: number;
  };
  queue: { inline: boolean; prefix: string };
  tickets: { signingSeed: string; signingKeyId: string };
  // SafeTix (Ola 6.5): TTL del token de puerta (corto/fresco) y del manifiesto
  // firmado (caduca offline; lleva secretos TOTP en claro), en segundos.
  safetix: { gateTokenTtl: number; manifestTtl: number };
  // Desbloqueo de edición de evento por ADMIN (v3.5): TTL en segundos del token que
  // devuelve la verificación del OTP (default 5 min).
  editUnlock: { ttl: number };
  wallet: { provider: string };
  retention: { enabled: boolean; days: number };
  cors: { origins: string[] };
}

export const configuration = (): AppConfig => {
  const env = (process.env.NODE_ENV ?? 'development') as AppConfig['env'];
  const bool = (v: string | undefined, def = false) =>
    v === undefined ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

  return {
    env,
    isProd: env === 'production',
    isDev: env === 'development',
    isTest: env === 'test',
    port: parseInt(process.env.PORT ?? '8080', 10),
    appName: process.env.APP_NAME ?? 'PasaEventos',
    database: { url: process.env.DATABASE_URL as string },
    redis: { url: process.env.REDIS_URL as string },
    // inline: el ingest de validación se aplica síncrono (tests deterministas y sin
    // consumidor AMQP colgando). En dev/prod se publica/consume por RabbitMQ.
    amqp: { url: process.env.AMQP_URL as string, inline: bool(process.env.RABBIT_INLINE, env === 'test') },
    storage: {
      provider: (process.env.STORAGE_PROVIDER ?? 's3') as 's3' | 'gcs',
      s3: {
        endpoint: process.env.S3_ENDPOINT as string,
        // Endpoint accesible por el NAVEGADOR (dev: LocalStack está detrás de un
        // host interno de docker no alcanzable desde el browser). Si se define, las
        // URLs firmadas de descarga reescriben el host interno por este. En prod
        // (GCS con endpoint público) se deja vacío y la URL firmada se usa tal cual.
        publicEndpoint: process.env.S3_PUBLIC_ENDPOINT || undefined,
        region: process.env.S3_REGION ?? 'us-east-1',
        bucket: process.env.S3_BUCKET as string,
        accessKeyId: process.env.S3_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY as string,
        forcePathStyle: bool(process.env.S3_FORCE_PATH_STYLE, true),
      },
      gcs: {
        projectId: process.env.GCLOUD_PROJECT_ID ?? '',
        bucket: process.env.GCS_BUCKET ?? '',
        serviceAccountJson: process.env.GCS_SERVICE_ACCOUNT_JSON ?? '',
      },
    },
    mail: {
      host: process.env.MAIL_HOST as string,
      port: parseInt(process.env.MAIL_PORT ?? '1025', 10),
      user: process.env.MAIL_USER ?? '',
      pass: process.env.MAIL_PASS ?? '',
      secure: bool(process.env.MAIL_SECURE, false),
      from: process.env.MAIL_FROM ?? 'no-reply@pasaeventos.com',
    },
    jwt: {
      accessSecret: process.env.JWT_ACCESS_SECRET as string,
      accessTtl: parseInt(process.env.JWT_ACCESS_TTL ?? '900', 10),
      refreshSecret: process.env.JWT_REFRESH_SECRET as string,
      refreshTtl: parseInt(process.env.JWT_REFRESH_TTL ?? '1209600', 10),
    },
    security: { encryptionKey: process.env.APP_ENCRYPTION_KEY as string },
    oauth: { google: { clientId: process.env.GOOGLE_CLIENT_ID ?? '' } },
    payment: {
      provider: process.env.PAYMENT_PROVIDER ?? 'simulator',
      webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret-change-me',
      // Auto-confirm OFF por defecto y SIEMPRE en test (los e2e disparan el webhook
      // manualmente y de forma determinista).
      simulatorAutoConfirm: env !== 'test' && bool(process.env.PAYMENT_SIMULATOR_AUTO_CONFIRM),
      simulatorJitterMinMs: parseInt(process.env.PAYMENT_SIMULATOR_JITTER_MIN_MS ?? '1000', 10),
      simulatorJitterMaxMs: parseInt(process.env.PAYMENT_SIMULATOR_JITTER_MAX_MS ?? '5000', 10),
    },
    // Colas (BullMQ). En modo inline los jobs corren síncronos (tests deterministas
    // y sin workers colgando handles); en async se empujan a BullMQ sobre Redis.
    queue: {
      inline: bool(process.env.QUEUE_INLINE, env === 'test'),
      prefix: process.env.QUEUE_PREFIX ?? 'pe',
    },
    // Firma de boletos (Ed25519). El seed (32 bytes hex) construye el par de llaves
    // de forma determinista; en prod DEBE venir de Secret Manager y ser rotable.
    tickets: {
      signingSeed:
        process.env.TICKET_SIGNING_SEED ??
        '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
      signingKeyId: process.env.TICKET_SIGNING_KEY_ID ?? 'dev-ed25519-1',
    },
    safetix: {
      gateTokenTtl: parseInt(process.env.SAFETIX_GATE_TOKEN_TTL ?? '1800', 10), // 30 min
      manifestTtl: parseInt(process.env.SAFETIX_MANIFEST_TTL ?? '21600', 10), // 6 h
    },
    editUnlock: {
      ttl: parseInt(process.env.EVENT_EDIT_UNLOCK_TTL ?? '300', 10), // 5 min
    },
    // Pases de wallet (Google/Apple). 'stub' = simulador sin certificados de
    // terceros (los E2E no dependen de Apple Developer / Google Wallet API).
    wallet: { provider: process.env.WALLET_PROVIDER ?? 'stub' },
    // Retención/privacidad: job programado (desactivado por defecto y en test) que
    // anonimiza PII de usuarios cuyos eventos concluyeron hace más de `days`.
    retention: {
      enabled: bool(process.env.RETENTION_ENABLED, false),
      days: parseInt(process.env.RETENTION_DAYS ?? '365', 10),
    },
    cors: {
      origins: (process.env.CORS_ORIGINS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },
  };
};
