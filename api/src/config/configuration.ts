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
  jwt: {
    accessSecret: string;
    accessTtl: number;
    refreshSecret: string;
    refreshTtl: number;
    impersonationTtl: number;
  };
  security: {
    encryptionKey: string;
    // Config de `trust proxy` de Express: cuántos proxies confiables hay DELANTE de la
    // app (Cloud Run/LB) para que `req.ip` sea la IP REAL del cliente y no sea spoofeable
    // vía X-Forwarded-For. Número de hops, boolean, o lista de subredes. Default false
    // (dev/local, sin proxy → usa el socket). En prod GCP: número de proxies (p.ej. 1-2).
    trustProxy: boolean | number | string;
  };
  oauth: { google: { clientId: string; clientSecret: string } };
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
  // Anti-abuso de reservas ANÓNIMAS (visitantes sin login): 1 reserva activa por IP
  // + cooldown tras cancelar. TTL en segundos (default 1 h). limitEnabled apaga la regla.
  reservation: { anonLimitEnabled: boolean; anonCooldownSeconds: number };
  // Rate-limiting por IP (Redis). enabled apaga TODO (OFF en test). globalPerMinute =
  // techo por IP por minuto para cualquier endpoint sin límite específico.
  rateLimit: { enabled: boolean; globalPerMinute: number };
  // Órdenes: tope de órdenes PENDIENTES de pago por comprador (anti-abuso 2.2).
  orders: { maxPendingPerBuyer: number };
  wallet: {
    provider: string;
    // Apple Wallet (.pkpass): env-only por ahora (requiere Apple Developer). Si falta
    // algún campo, el servicio de pase Apple queda NO DISPONIBLE (503 al pedirlo).
    apple: {
      passTypeId: string;
      teamId: string;
      certP12Base64: string; // certificado Pass Type ID (.p12) en base64
      certPassword: string;
      wwdrBase64: string; // Apple WWDR cert en base64
    };
    // Google Wallet: value-ready. Con issuerId + service account JSON firma el JWT
    // de "Guardar en Google Wallet". Si falta → NO DISPONIBLE.
    google: { issuerId: string; serviceAccountJson: string };
  };
  // Pasarela Recurrente (principal). Env-only por ahora (pagos complejos): si falta
  // apiKey/apiSecret el proveedor queda NO DISPONIBLE (503 al intentar cobrar con él).
  recurrente: {
    apiKey: string;
    apiSecret: string;
    webhookSecret: string;
    baseUrl: string;
  };
  // Pasarela Pagalo (failover). Value-ready (modelo real pagalocard). Endpoint:
  // POST https://{dominio}/api/v1/integracion/{credencial}. `credencial`, `dominio`
  // y `estado` (sandbox/produccion) los tiene el usuario; las llaves de empresa
  // (keyPublic/keySecret/idenEmpresa) vienen de GCP Secret Manager.
  pagalo: {
    credencial: string; // segmento de integración en la URL
    dominio: string; // host, p.ej. sandbox.pagalocard.com
    estado: string; // 'sandbox' | 'produccion'
    keyPublic: string;
    keySecret: string;
    idenEmpresa: string;
    webhookSecret: string;
  };
  // FEL (certificador SAT). Env-only por ahora: sin credenciales el certificador
  // queda NO DISPONIBLE (la factura no bloquea la entrega; se encola y reintenta).
  fel: {
    certifier: string; // proveedor: infile | digifact | guatefacturas | ...
    apiUser: string;
    apiKey: string;
    requestorNit: string; // NIT del emisor (plataforma)
    baseUrl: string;
  };
  // reCAPTCHA (anti-abuso). Value-ready: con secretKey verifica los tokens contra
  // Google. `disabled` (o falta de secretKey) OMITE la verificación → NO bloquea
  // pruebas (E2E/dev). En prod se exige secretKey y disabled=false.
  recaptcha: {
    siteKey: string; // pública (va al frontend)
    secretKey: string; // privada (verificación server-side)
    minScore: number; // v3: score mínimo aceptado
    disabled: boolean;
  };
  // GCP (deploy / Secret Manager / wallet). projectId + region para las Actions.
  gcp: { projectId: string; region: string };
  retention: { enabled: boolean; days: number };
  cors: { origins: string[] };
}

/** Parseo del env TRUST_PROXY → valor aceptado por `app.set('trust proxy', …)`. */
function parseTrustProxy(raw: string | undefined): boolean | number | string {
  if (raw === undefined || raw === '') return false;
  const lower = raw.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0) return n;
  return raw; // lista de subredes/hosts confiables (p.ej. "loopback, 10.0.0.0/8")
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
    appName: process.env.APP_NAME ?? 'Boletiva',
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
      // Token de IMPERSONACIÓN (soporte, v3.8): vida corta (default 30 min).
      impersonationTtl: parseInt(process.env.IMPERSONATION_TOKEN_TTL ?? '1800', 10),
    },
    security: {
      encryptionKey: process.env.APP_ENCRYPTION_KEY as string,
      trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    },
    oauth: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID ?? '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      },
    },
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
    reservation: {
      // OFF en test (los e2e crean muchas reservas anónimas seguidas).
      anonLimitEnabled: (process.env.RESERVATION_ANON_LIMIT ?? 'true').toLowerCase() !== 'false',
      anonCooldownSeconds: parseInt(process.env.RESERVATION_ANON_COOLDOWN_SECONDS ?? '3600', 10), // 1 h
    },
    rateLimit: {
      // OFF en test (los e2e disparan muchas peticiones seguidas desde una IP).
      enabled: (process.env.RATE_LIMIT_ENABLED ?? 'true').toLowerCase() !== 'false',
      globalPerMinute: parseInt(process.env.RATE_LIMIT_GLOBAL_PER_MIN ?? '300', 10),
    },
    orders: {
      maxPendingPerBuyer: parseInt(process.env.ORDERS_MAX_PENDING_PER_BUYER ?? '5', 10),
    },
    // Pases de wallet (Google/Apple). 'stub' = simulador sin certificados de
    // terceros (los E2E no dependen de Apple Developer / Google Wallet API).
    wallet: {
      provider: process.env.WALLET_PROVIDER ?? 'stub',
      apple: {
        passTypeId: process.env.APPLE_WALLET_PASS_TYPE_ID ?? '',
        teamId: process.env.APPLE_WALLET_TEAM_ID ?? '',
        certP12Base64: process.env.APPLE_WALLET_CERT_P12_BASE64 ?? '',
        certPassword: process.env.APPLE_WALLET_CERT_PASSWORD ?? '',
        wwdrBase64: process.env.APPLE_WALLET_WWDR_BASE64 ?? '',
      },
      google: {
        issuerId: process.env.GOOGLE_WALLET_ISSUER_ID ?? '',
        serviceAccountJson: process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON ?? '',
      },
    },
    recurrente: {
      apiKey: process.env.RECURRENTE_API_KEY ?? '',
      apiSecret: process.env.RECURRENTE_API_SECRET ?? '',
      webhookSecret: process.env.RECURRENTE_WEBHOOK_SECRET ?? '',
      baseUrl: process.env.RECURRENTE_BASE_URL ?? 'https://app.recurrente.com/api',
    },
    pagalo: {
      credencial: process.env.PAGALO_CREDENCIAL ?? '',
      dominio: process.env.PAGALO_DOMINIO ?? 'sandbox.pagalocard.com',
      estado: process.env.PAGALO_ESTADO ?? 'sandbox',
      keyPublic: process.env.PAGALO_KEY_PUBLIC ?? '',
      keySecret: process.env.PAGALO_KEY_SECRET ?? '',
      idenEmpresa: process.env.PAGALO_IDEN_EMPRESA ?? '',
      webhookSecret: process.env.PAGALO_WEBHOOK_SECRET ?? '',
    },
    fel: {
      certifier: process.env.FEL_CERTIFIER ?? '',
      apiUser: process.env.FEL_API_USER ?? '',
      apiKey: process.env.FEL_API_KEY ?? '',
      requestorNit: process.env.FEL_REQUESTOR_NIT ?? '',
      baseUrl: process.env.FEL_BASE_URL ?? '',
    },
    recaptcha: {
      siteKey: process.env.RECAPTCHA_SITE_KEY ?? '',
      secretKey: process.env.RECAPTCHA_SECRET_KEY ?? '',
      minScore: parseFloat(process.env.RECAPTCHA_MIN_SCORE ?? '0.5'),
      // Se desactiva explícitamente, o implícitamente en test, o si no hay secretKey.
      disabled: bool(process.env.RECAPTCHA_DISABLED, env === 'test'),
    },
    gcp: {
      projectId: process.env.GCLOUD_PROJECT_ID ?? '',
      region: process.env.GCP_REGION ?? 'us-central1',
    },
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
