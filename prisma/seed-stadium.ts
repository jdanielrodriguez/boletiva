import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as bcrypt from 'bcrypt';
import { makePrismaClient } from './prisma-client';

/**
 * Seeder de carga: un "estadio" con N asientos disponibles + un pool de
 * compradores verificados con dispositivo confiable (para que K6 haga login sin
 * 2FA). Reinicia el evento en cada corrida (estado limpio y repetible) y escribe
 * un manifiesto JSON que consume el script de K6.
 *
 *   STADIUM_SEATS  (default 10000)  asientos disponibles
 *   STADIUM_BUYERS (default 100)    compradores del pool
 *
 * Meta: crear 10k asientos en < 10s (createMany por lotes).
 */
const SEATS = Number(process.env.STADIUM_SEATS ?? 10000);
const BUYERS = Number(process.env.STADIUM_BUYERS ?? 100);
const SLUG = 'estadio-load-test';
const DEVICE_PREFIX = 'k6-device-';
const CHUNK = 5000;

const prisma = makePrismaClient();
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function main(): Promise<void> {
  const t0 = Date.now();

  const promoter = await prisma.user.findUniqueOrThrow({
    where: { email: 'promotor@pasaeventos.com' },
  });

  // Reset idempotente del evento de carga (órdenes primero por FK).
  const existing = await prisma.event.findUnique({ where: { slug: SLUG } });
  if (existing) {
    await prisma.order.deleteMany({ where: { eventId: existing.id } });
    await prisma.event.delete({ where: { id: existing.id } }); // cascada: localities → seats
  }

  const event = await prisma.event.create({
    data: {
      promoterId: promoter.id,
      name: 'Estadio Load Test',
      slug: SLUG,
      description: 'Evento sintético para pruebas de carga (K6).',
      startsAt: new Date('2027-06-01T20:00:00-06:00'),
      endsAt: new Date('2027-06-01T23:00:00-06:00'),
      status: 'published',
    },
  });
  const locality = await prisma.locality.create({
    data: {
      eventId: event.id,
      name: 'Graderío',
      slug: 'graderio',
      kind: 'general',
      capacity: SEATS,
      desiredNet: 100,
    },
  });

  // Crear asientos por lotes (rápido).
  for (let start = 0; start < SEATS; start += CHUNK) {
    const end = Math.min(start + CHUNK, SEATS);
    await prisma.seat.createMany({
      data: Array.from({ length: end - start }, (_, i) => ({
        localityId: locality.id,
        label: `S${start + i + 1}`,
      })),
    });
  }
  const seatsMs = Date.now() - t0;

  // Pool de compradores verificados con dispositivo confiable (login sin 2FA).
  const passwordHash = await bcrypt.hash('Password123', 12);
  const buyers: Array<{ email: string; deviceId: string }> = [];
  for (let i = 0; i < BUYERS; i++) {
    const email = `loadbuyer${i}@pasaeventos.com`;
    const deviceId = `${DEVICE_PREFIX}${i}`;
    const user = await prisma.user.upsert({
      where: { email },
      update: { emailVerifiedAt: new Date() },
      create: { email, firstName: `Load${i}`, passwordHash, emailVerifiedAt: new Date() },
    });
    await prisma.device.upsert({
      where: { userId_deviceHash: { userId: user.id, deviceHash: sha256(deviceId) } },
      update: { trustedAt: new Date() },
      create: { userId: user.id, deviceHash: sha256(deviceId), trustedAt: new Date() },
    });
    buyers.push({ email, deviceId });
  }

  const seats = await prisma.seat.findMany({
    where: { localityId: locality.id },
    select: { id: true },
  });
  const seatIds = seats.map((s) => s.id);

  const manifest = {
    baseUrl: process.env.LOAD_BASE_URL ?? 'http://pasaeventos_api:8080/api/v1',
    eventId: event.id,
    localityId: locality.id,
    capacity: SEATS,
    seatIds,
    buyers,
  };
  const outDir = join(process.cwd(), 'load');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'stadium.manifest.json'), JSON.stringify(manifest));

  const totalMs = Date.now() - t0;
  console.log(
    `Estadio OK → ${SEATS} asientos (${seatsMs} ms) + ${BUYERS} compradores. ` +
      `Total ${totalMs} ms. Manifiesto: load/stadium.manifest.json`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
