import { PrismaClient } from '@prisma/client';

/**
 * Trunca TODAS las tablas del esquema público (CASCADE resuelve las FKs), dejando
 * la BD vacía pero con el esquema intacto. Usa `DATABASE_URL` del entorno → sirve
 * tanto local como contra PROD (el Makefile `prod-db-reset` lo invoca inyectando el
 * DATABASE_URL de Secret Manager). DESTRUCTIVO: no siembra (eso lo hace `db:seed`).
 */
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  const tables = rows.map((r) => `"${r.tablename}"`);
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  }
  console.log(`Truncadas ${tables.length} tablas.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
