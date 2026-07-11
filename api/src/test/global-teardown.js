/* eslint-disable */
const { execSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

/**
 * Teardown GLOBAL de la suite e2e (v3.8). Los e2e escriben libremente en la BD
 * Postgres real compartida; para que la suite quede IDEMPOTENTE y NO ensucie una
 * base compartida (requisito de staging/prod, que no guardan data de test), al
 * terminar TODO el run se trunca cada tabla del esquema público (CASCADE resuelve
 * las FKs) y se RE-SIEMBRA la baseline mínima (admin/promotor/cliente + 1 evento
 * demo + settings + pasarelas + categorías + salones + plantillas).
 *
 * Corre una sola vez, después del último test. Es best-effort: si algo falla, lo
 * registra pero no marca el run como fallido (el resultado debe reflejar los tests,
 * no la limpieza). Se deja en CommonJS (.js) para que Jest lo cargue sin transform.
 */
module.exports = async function globalTeardown() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    const tables = rows.map((r) => `"${r.tablename}"`);
    if (tables.length) {
      await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`,
      );
    }
  } catch (err) {
    console.warn('[global-teardown] no se pudo truncar la BD:', err.message);
  } finally {
    await prisma.$disconnect();
  }

  // Re-siembra la baseline mínima para dejar la BD como recién inicializada.
  try {
    execSync('npm run db:seed', { cwd: '/app', stdio: 'inherit' });
  } catch (err) {
    console.warn('[global-teardown] no se pudo re-sembrar:', err.message);
  }
};
