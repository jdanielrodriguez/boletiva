import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

/**
 * Defaults de DESARROLLO (Joi) que NUNCA deben llegar a producción. Si alguno se cuela
 * (secreto no inyectado en Cloud Run/Secret Manager), un atacante que conozca estos
 * valores públicos podría forjar webhooks de pago, boletos Ed25519 o tokens JWT, o
 * descifrar la PII en reposo. Ver auditoría dual C1.
 */
const INSECURE_DEFAULTS: Record<string, string> = {
  'jwt.accessSecret': 'dev-access-secret-change-me',
  'jwt.refreshSecret': 'dev-refresh-secret-change-me',
  'security.encryptionKey': '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  'payment.webhookSecret': 'dev-webhook-secret-change-me',
  'tickets.signingSeed': '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
};

/**
 * Guard de arranque (fail-fast) para PRODUCCIÓN. Aborta el boot si detecta config
 * insegura: secretos con el default de dev (C1), `trust proxy` mal parametrizado
 * (C2/H3 — debe ser el nº exacto de proxies, no true/false) o CORS `*` con credenciales
 * (M5). No hace nada fuera de producción. Se llama en `bootstrap()` antes de `listen`.
 */
export function assertProductionSecurity(config: ConfigService): void {
  if (!config.get<boolean>('isProd')) return;
  const logger = new Logger('SecurityBootGuard');
  const problems: string[] = [];

  // C1 · secretos con default de desarrollo
  for (const [key, dev] of Object.entries(INSECURE_DEFAULTS)) {
    if (config.get<string>(key) === dev) {
      problems.push(`Secreto '${key}' tiene el valor por DEFECTO de desarrollo (inyéctalo desde Secret Manager).`);
    }
  }

  // C2/H3 · trust proxy debe ser un entero ≥ 1 (nº de proxies confiables), no true/false/lista
  const tp = config.get<boolean | number | string>('security.trustProxy');
  if (typeof tp !== 'number' || !Number.isInteger(tp) || tp < 1) {
    problems.push(
      `TRUST_PROXY debe ser el número exacto de proxies confiables (p.ej. 1 o 2) en prod; ` +
        `recibido: ${JSON.stringify(tp)}. 'true' es spoofeable y 'false' colapsa el rate-limit por IP.`,
    );
  }

  // M5 · CORS '*' con credentials es inseguro
  const origins = config.get<string[]>('cors.origins') ?? [];
  if (origins.includes('*')) {
    problems.push(`CORS_ORIGINS no puede contener '*' en prod (se envían credenciales).`);
  }

  // QA · el SIMULADOR de pagos jamás debe ser el proveedor en producción: con
  // auto-confirm marca órdenes como pagadas SIN cobro real (o las deja pending para
  // siempre). Prod exige una pasarela real (recurrente/pagalo). El nº de pasarelas
  // reales activas en BD se valida aparte (arranque async); aquí cortamos el default.
  const provider = (config.get<string>('payment.provider') ?? 'simulator').toLowerCase();
  if (provider === 'simulator') {
    problems.push(
      `PAYMENT_PROVIDER no puede ser 'simulator' en prod: cobraría de mentira. ` +
        `Configura una pasarela real (recurrente/pagalo).`,
    );
  }

  if (problems.length > 0) {
    logger.error('Configuración de PRODUCCIÓN insegura — se aborta el arranque:');
    for (const p of problems) logger.error(`  • ${p}`);
    throw new Error(`Arranque abortado: ${problems.length} problema(s) de seguridad en la config de producción.`);
  }
  logger.log('Config de producción validada (secretos, trust proxy, CORS).');
}
