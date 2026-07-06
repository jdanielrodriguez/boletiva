import * as Joi from 'joi';

/**
 * Esquema de validación de variables de entorno.
 * La app NO arranca si el entorno es inválido (fail-fast).
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(8080),
  APP_NAME: Joi.string().default('PasaEventos'),
  TZ: Joi.string().default('America/Guatemala'),

  // Base de datos (Prisma / PostgreSQL)
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),

  // Redis
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),

  // RabbitMQ
  AMQP_URL: Joi.string()
    .uri({ scheme: ['amqp', 'amqps'] })
    .required(),

  // Almacenamiento
  STORAGE_PROVIDER: Joi.string().valid('s3', 'gcs').default('s3'),
  S3_ENDPOINT: Joi.string().uri().when('STORAGE_PROVIDER', { is: 's3', then: Joi.required() }),
  S3_REGION: Joi.string().default('us-east-1'),
  S3_BUCKET: Joi.string().when('STORAGE_PROVIDER', { is: 's3', then: Joi.required() }),
  S3_ACCESS_KEY_ID: Joi.string().when('STORAGE_PROVIDER', { is: 's3', then: Joi.required() }),
  S3_SECRET_ACCESS_KEY: Joi.string().when('STORAGE_PROVIDER', { is: 's3', then: Joi.required() }),
  S3_FORCE_PATH_STYLE: Joi.boolean().default(true),
  GCLOUD_PROJECT_ID: Joi.string().allow('').optional(),
  GCS_BUCKET: Joi.string().allow('').optional(),
  GCS_SERVICE_ACCOUNT_JSON: Joi.string().allow('').optional(),

  // Correo
  MAIL_HOST: Joi.string().required(),
  MAIL_PORT: Joi.number().default(1025),
  MAIL_USER: Joi.string().allow('').optional(),
  MAIL_PASS: Joi.string().allow('').optional(),
  MAIL_SECURE: Joi.boolean().default(false),
  MAIL_FROM: Joi.string().default('no-reply@pasaeventos.com'),

  // Auth (se usa desde la Ola 1)
  JWT_ACCESS_SECRET: Joi.string().default('dev-access-secret-change-me'),
  JWT_ACCESS_TTL: Joi.number().default(900),
  JWT_REFRESH_SECRET: Joi.string().default('dev-refresh-secret-change-me'),
  JWT_REFRESH_TTL: Joi.number().default(1209600),

  // Llave de cifrado simétrico en reposo (AES-256-GCM), 32 bytes en hex (64 chars).
  // En prod DEBE venir de Secret Manager y ser única/rotable.
  APP_ENCRYPTION_KEY: Joi.string()
    .hex()
    .length(64)
    .default('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'),

  // Google OAuth (opcional; si falta, el login con Google queda deshabilitado)
  GOOGLE_CLIENT_ID: Joi.string().allow('').optional(),

  // Pagos (Ola 3)
  PAYMENT_PROVIDER: Joi.string().default('simulator'),

  // Observabilidad (OpenTelemetry). Desactivado salvo OTEL_ENABLED=true o que se
  // defina un endpoint OTLP. Traza el camino de compra (hold→commit).
  OTEL_ENABLED: Joi.boolean().default(false),
  OTEL_SERVICE_NAME: Joi.string().default('pasaeventos-api'),
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().uri().allow('').optional(),

  // CORS
  CORS_ORIGINS: Joi.string().required(),
}).unknown(true);
