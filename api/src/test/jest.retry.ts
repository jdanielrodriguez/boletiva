/**
 * Reintento de tests SOLO en CI. Los e2e comparten una BD Postgres/Redis/RabbitMQ
 * REAL y corren en serie (maxWorkers:1); en el runner de GitHub (2 cores/7GB, bajo
 * carga del stack Docker) un test sensible al tiempo puede fallar de forma transitoria
 * aunque pase siempre en local (verificado: 985/985 estable local + repro fiel del job).
 *
 * `jest.retryTimes(2)` reintenta un test fallido hasta 2 veces: una **flake transitoria**
 * se recupera, pero un **bug real** falla los 3 intentos → no enmascara regresiones.
 * Se activa SOLO con `CI=true` (lo pone GitHub Actions) → local sigue sin retry para
 * que las flakes reales se vean de inmediato. `logErrorsBeforeRetry` deja traza del intento.
 */
if (process.env.CI === 'true') {
  jest.retryTimes(2, { logErrorsBeforeRetry: true });
}
