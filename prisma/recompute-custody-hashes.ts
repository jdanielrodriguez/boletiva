import { makePrismaClient } from './prisma-client';
import { computeCustodyHash } from '../api/src/modules/tickets/custody-hash.util';

/**
 * Migración de deploy (G6.1 · Auditoría 4): recomputa la cadena de custodia de TODOS
 * los boletos con la fórmula vigente del hash (que ahora incluye `actorId`). Ejecutar
 * UNA VEZ tras desplegar el cambio de `computeCustodyHash`, de lo contrario
 * `verifyChain` fallaría sobre los eventos históricos (creados con la fórmula anterior).
 *
 * Seguro para correr de nuevo (idempotente: solo reescribe lo que cambia) y por-boleto
 * (advisory lock por ticket, como el append en vivo) → no bloquea toda la tabla ni el
 * arranque. Correr en mantenimiento o en horario de baja carga.
 *
 *   docker exec pasaeventos_api npm run db:custody-migrate
 */
async function main(): Promise<void> {
  const prisma = makePrismaClient();
  try {
    const tickets = await prisma.ticketCustodyEvent.findMany({
      distinct: ['ticketId'],
      select: { ticketId: true },
    });
    let chains = 0;
    let rewritten = 0;
    for (const { ticketId } of tickets) {
      const n = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ticketId}))`;
        const events = await tx.ticketCustodyEvent.findMany({
          where: { ticketId },
          orderBy: { seq: 'asc' },
        });
        let prev = '';
        let count = 0;
        for (const e of events) {
          const hash = computeCustodyHash({
            prevHash: prev,
            ticketId,
            seq: e.seq,
            type: e.type,
            fromOwnerId: e.fromOwnerId,
            toOwnerId: e.toOwnerId,
            actorId: e.actorId,
            createdAt: e.createdAt,
          });
          if (e.prevHash !== prev || e.hash !== hash) {
            await tx.ticketCustodyEvent.update({ where: { id: e.id }, data: { prevHash: prev, hash } });
            count++;
          }
          prev = hash;
        }
        return count;
      });
      chains++;
      rewritten += n;
    }
    console.log(`Custody hash v2: ${chains} cadenas revisadas, ${rewritten} eslabones recomputados.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
