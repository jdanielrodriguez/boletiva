// Setup de entorno para los tests (se ejecuta antes de cargar los módulos).
//
// Fuerza NODE_ENV=test ANTES de que se cargue la configuración (config lee
// process.env al importar los módulos). El contenedor corre con NODE_ENV=development
// y jest NO lo sobreescribe si ya está definido → sin esto, `env !== 'test'` deja
// ACTIVO el auto-confirm con jitter del simulador (`PAYMENT_SIMULATOR_AUTO_CONFIRM`),
// que a los 1.5–4s dispara un `payment.succeeded` diferido: éste re-ejecuta `fulfill`
// sobre órdenes ya reembolsadas y las resucita a `paid` → flaky cross-suite en las
// e2e de reembolsos. El auto-confirm debe estar SIEMPRE OFF en test (intención
// documentada); forzar el env aquí lo garantiza en cualquier entorno de ejecución.
process.env.NODE_ENV = 'test';
// Fuerza las colas en modo INLINE: los jobs corren síncronos → E2E deterministas
// y sin workers de BullMQ dejando handles abiertos. En dev/prod queda async.
process.env.QUEUE_INLINE = process.env.QUEUE_INLINE ?? 'true';
// Ingest de validación (RabbitMQ) también inline en tests: aplicación síncrona,
// sin consumidor AMQP dejando handles abiertos.
process.env.RABBIT_INLINE = process.env.RABBIT_INLINE ?? 'true';

// Neutraliza TODAS las credenciales de integración externa: la suite debe ser
// HERMÉTICA e independiente de lo que tenga el `.env` del desarrollador. Sin esto,
// poner llaves reales (Google/Pagalo/reCAPTCHA…) en `.env` volvería no-deterministas
// los e2e que asumen "servicio no configurado" (p.ej. login con Google → 503, o el
// captcha que se OMITE). El default siempre es: pagos=simulador, wallet=stub,
// captcha desactivado, y todo lo demás sin credenciales (available=false).
//
// Se ASIGNA '' (no `delete`): @nestjs/config hace `config = {...archivoEnv, ...process.env}`,
// así que un valor en process.env GANA sobre el archivo `.env`. Con `delete`, el valor
// del archivo rellenaría el hueco; con '' explícito, la credencial queda vacía sí o sí.
process.env.PAYMENT_PROVIDER = 'simulator';
process.env.WALLET_PROVIDER = 'stub';
process.env.RECAPTCHA_DISABLED = 'true';
for (const key of [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_WALLET_ISSUER_ID',
  'GOOGLE_WALLET_SERVICE_ACCOUNT_JSON',
  'RECAPTCHA_SITE_KEY',
  'RECAPTCHA_SECRET_KEY',
  'PAGALO_CREDENCIAL',
  'PAGALO_KEY_PUBLIC',
  'PAGALO_KEY_SECRET',
  'PAGALO_IDEN_EMPRESA',
  'PAGALO_WEBHOOK_SECRET',
  'RECURRENTE_API_KEY',
  'RECURRENTE_API_SECRET',
  'RECURRENTE_WEBHOOK_SECRET',
  'FEL_CERTIFIER',
  'FEL_API_USER',
  'FEL_API_KEY',
  'FEL_REQUESTOR_NIT',
  'FEL_BASE_URL',
  'APPLE_WALLET_PASS_TYPE_ID',
  'APPLE_WALLET_TEAM_ID',
  'APPLE_WALLET_CERT_P12_BASE64',
  'APPLE_WALLET_CERT_PASSWORD',
  'APPLE_WALLET_WWDR_BASE64',
]) {
  process.env[key] = '';
}
