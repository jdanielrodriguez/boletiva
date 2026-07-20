import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Fábrica del cliente Prisma para los scripts standalone (seed, seed-stadium,
 * truncate). Prisma 7 exige un driver adapter en el constructor (ya no hay
 * `datasource.url` en el schema ni motor Rust). Usa `DATABASE_URL` del entorno.
 */
export function makePrismaClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
}
