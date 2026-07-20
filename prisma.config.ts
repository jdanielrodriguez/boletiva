import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Configuración de Prisma 7 (reemplaza el bloque `prisma` de package.json y la
 * `datasource.url` del schema, ambos removidos en v7). El cliente en runtime usa
 * el driver adapter `@prisma/adapter-pg` (ver PrismaService); aquí solo va la URL
 * que necesitan los comandos de MIGRACIÓN/introspección (migrate/db push/studio).
 * `DATABASE_URL` llega por entorno (12-factor), igual local y en prod.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node --project tsconfig.tools.json prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
