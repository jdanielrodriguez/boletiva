import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import { trace } from '@opentelemetry/api';

/**
 * Inicialización de OpenTelemetry. Debe ejecutarse ANTES de cargar Nest/Express/
 * Prisma (la auto-instrumentación parchea esos módulos al requerirse); por eso
 * `main.ts` importa este archivo en su primera línea.
 *
 * Desactivado por defecto: se enciende con OTEL_ENABLED=true o definiendo
 * OTEL_EXPORTER_OTLP_ENDPOINT. Así no añade overhead ni ruido en dev/test y queda
 * listo para producción (Cloud Run → colector/Jaeger). Traza el camino crítico de
 * compra (hold→commit) con spans manuales + spans automáticos de HTTP/Prisma/Redis.
 */
const TRACER_NAME = 'pasaeventos.checkout';

let sdk: NodeSDK | undefined;

function isEnabled(): boolean {
  const flag = (process.env.OTEL_ENABLED ?? '').toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(flag) || !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
}

export function startTracing(): void {
  if (!isEnabled() || sdk) return;
  if (!process.env.OTEL_SERVICE_NAME) process.env.OTEL_SERVICE_NAME = 'pasaeventos-api';

  try {
    sdk = new NodeSDK({
      traceExporter: new OTLPTraceExporter(), // usa OTEL_EXPORTER_OTLP_ENDPOINT
      instrumentations: [
        getNodeAutoInstrumentations({
          // fs es muy ruidoso y no aporta al camino de compra.
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
        new PrismaInstrumentation(),
      ],
    });
    sdk.start();

    const shutdown = () => {
      void sdk?.shutdown().finally(() => process.exit(0));
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    console.log('[otel] tracing iniciado');
  } catch (e) {
    // Nunca tumbar el arranque de la app por observabilidad.
    console.error('[otel] no se pudo iniciar el tracing:', e);
  }
}

/** Tracer del dominio de compra (no-op si OTel está desactivado). */
export const checkoutTracer = () => trace.getTracer(TRACER_NAME);

// Efecto de importación: arranca el tracing lo antes posible.
startTracing();
