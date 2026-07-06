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
  amqp: { url: string };
  storage: {
    provider: 's3' | 'gcs';
    s3: {
      endpoint: string;
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
  payment: { provider: string };
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
    amqp: { url: process.env.AMQP_URL as string },
    storage: {
      provider: (process.env.STORAGE_PROVIDER ?? 's3') as 's3' | 'gcs',
      s3: {
        endpoint: process.env.S3_ENDPOINT as string,
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
    payment: { provider: process.env.PAYMENT_PROVIDER ?? 'simulator' },
    cors: {
      origins: (process.env.CORS_ORIGINS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },
  };
};
