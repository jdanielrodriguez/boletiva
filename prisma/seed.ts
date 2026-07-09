import { PrismaClient, PromoterStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/**
 * Seed base: configuración del sistema, roles/usuarios por defecto, categorías
 * y un evento demo publicado con localidades y asientos. Idempotente.
 */
async function seedSettings(): Promise<void> {
  const defaults: Array<{ key: string; value: unknown; description: string }> = [
    {
      key: 'pricing.platform_fee_pct',
      value: 0.1,
      description: 'Comisión de plataforma sobre el neto del promotor (0.10 = 10%)',
    },
    {
      key: 'pricing.gateway_fee_pct',
      value: 0.05,
      description: 'Comisión de la pasarela sobre el total cobrado (0.05 = 5%)',
    },
    {
      key: 'pricing.iva_pct',
      value: 0.12,
      description: 'IVA Guatemala sobre la base gravable (neto + comisión plataforma)',
    },
    {
      key: 'wallet.withdraw_fee_promoter_pct',
      value: 0.03,
      description: 'Comisión de retiro de saldo interno para promotores',
    },
    {
      key: 'wallet.withdraw_fee_user_pct',
      value: 0.06,
      description: 'Comisión de retiro para usuarios (el doble que promotor)',
    },
    {
      key: 'transfer.max_per_ticket_default',
      value: 1,
      description: 'Máximo de transferencias por boleto por defecto',
    },
    {
      key: 'costshare.default_pct',
      value: 0.5,
      description:
        'Reparto por defecto de gastos EXTRA que asume el promotor (0.5 = 50%; 0 = plataforma cubre todo)',
    },
    {
      key: 'promoters.require_approval',
      value: true,
      description:
        'Exigir autorización de admin para operar como promotor (false = modo pruebas, auto-aprueba)',
    },
    {
      key: 'wallet.pass_fee',
      value: 0,
      description: 'Cargo EXTRA por generar un pase de wallet (0 = sin cargo). Se reparte prom↔plat',
    },
  ];
  for (const s of defaults) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { description: s.description },
      create: { key: s.key, value: s.value as object, description: s.description },
    });
  }
}

/** Tabla de comisiones v1 (activa), coherente con los settings de precios. */
async function seedFeeSchedule(): Promise<void> {
  const existing = await prisma.feeSchedule.findFirst();
  if (existing) return; // ya versionado; no re-crear
  await prisma.feeSchedule.create({
    data: {
      version: 1,
      label: 'Comisiones base (seed)',
      platformFeePct: '0.10000',
      gatewayFeePct: '0.05000',
      ivaPct: '0.12000',
      fixedFees: '0.00',
      active: true,
    },
  });
}

/**
 * Pasarelas de pago (alpha/beta corren sobre el simulador webhook-first).
 * Recurrente = default de plataforma con pago en CUOTAS (Visacuotas/Mastercuotas:
 * 3→8% · 6→9% · 12→10% · 18→14%, +Q2 fijo — tarifario real). Pagalo = alternativa
 * sin cuotas. Sandbox se conserva (compatibilidad). El 1 pago de Recurrente es 5%
 * (idéntico al anterior → los precios base no cambian). El `provider` real se
 * enchufa detrás del mismo puerto cuando lleguen credenciales. Idempotente.
 */
async function seedGateway(): Promise<void> {
  const gateways: Array<{
    name: string;
    provider: string;
    feePct: string;
    installmentRates?: Record<string, number>;
    installmentFixedFee?: string;
    sandbox: boolean;
  }> = [
    {
      name: 'Recurrente',
      provider: 'simulator',
      feePct: '0.05000',
      installmentRates: { '3': 0.08, '6': 0.09, '12': 0.1, '18': 0.14 },
      installmentFixedFee: '2.00',
      sandbox: true,
    },
    { name: 'Pagalo', provider: 'simulator', feePct: '0.05000', sandbox: true },
    { name: 'Sandbox', provider: 'simulator', feePct: '0.05000', sandbox: true },
  ];
  for (const g of gateways) {
    await prisma.paymentGateway.upsert({
      where: { name: g.name },
      update: {
        installmentRates: g.installmentRates,
        installmentFixedFee: g.installmentFixedFee,
      },
      create: {
        name: g.name,
        provider: g.provider,
        feePct: g.feePct,
        installmentRates: g.installmentRates,
        installmentFixedFee: g.installmentFixedFee,
        sandbox: g.sandbox,
        status: 'active',
      },
    });
  }
  // Garantizar una sola default = Recurrente (sin violar el índice parcial).
  await prisma.$transaction([
    prisma.paymentGateway.updateMany({
      where: { isPlatformDefault: true, name: { not: 'Recurrente' } },
      data: { isPlatformDefault: false },
    }),
    prisma.paymentGateway.updateMany({
      where: { name: 'Recurrente' },
      data: { isPlatformDefault: true, status: 'active' },
    }),
  ]);
}

async function seedUsers() {
  const password = await bcrypt.hash('Password123', 12);
  const users: Array<{
    email: string;
    firstName: string;
    roles: Role[];
    promoterStatus?: PromoterStatus;
  }> = [
    { email: 'admin@pasaeventos.com', firstName: 'Admin', roles: [Role.admin] },
    {
      email: 'promotor@pasaeventos.com',
      firstName: 'Promotor',
      roles: [Role.promoter],
      promoterStatus: PromoterStatus.approved, // ya autorizado (puede operar)
    },
    { email: 'cliente@pasaeventos.com', firstName: 'Cliente', roles: [Role.buyer] },
  ];
  const created: Record<string, string> = {};
  for (const u of users) {
    const promoter =
      u.promoterStatus === PromoterStatus.approved
        ? { promoterStatus: PromoterStatus.approved, promoterDecidedAt: new Date() }
        : {};
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { roles: u.roles, emailVerifiedAt: new Date(), ...promoter },
      create: {
        email: u.email,
        firstName: u.firstName,
        passwordHash: password,
        roles: u.roles,
        emailVerifiedAt: new Date(), // usuarios semilla ya verificados
        ...promoter,
      },
    });
    created[u.email] = user.id;
  }
  return created;
}

async function seedCategories(adminId: string) {
  const names = ['Educación', 'Concierto', 'Conferencias', 'Convivio', 'Otros'];
  const ids: Record<string, string> = {};
  for (const name of names) {
    const slug = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '');
    const cat = await prisma.category.upsert({
      where: { slug },
      update: {},
      create: { name, slug, createdById: adminId },
    });
    ids[name] = cat.id;
  }
  return ids;
}

async function seedDemoEvent(promoterId: string, categoryId: string): Promise<void> {
  const slug = 'evento-demo-pasaeventos';
  const existing = await prisma.event.findUnique({ where: { slug } });
  if (existing) return;

  const event = await prisma.event.create({
    data: {
      promoterId,
      categoryId,
      name: 'Evento Demo Pasa Eventos',
      slug,
      description: 'Evento de ejemplo generado por el seed.',
      address: 'Ciudad de Guatemala',
      lat: 14.6349,
      lng: -90.5069,
      startsAt: new Date('2026-12-04T20:00:00-06:00'),
      endsAt: new Date('2026-12-04T23:00:00-06:00'),
      status: 'published',
    },
  });

  const vip = await prisma.locality.create({
    data: {
      eventId: event.id,
      name: 'Mesas VIP',
      slug: 'mesas-vip',
      kind: 'seated',
      desiredNet: 100,
    },
  });
  const general = await prisma.locality.create({
    data: {
      eventId: event.id,
      name: 'General',
      slug: 'general',
      kind: 'general',
      desiredNet: 75,
      capacity: 100,
    },
  });

  // Asientos numerados de la localidad con mapa (VIP), en una FILA CURVADA tipo
  // teatro (arco), para demostrar que el lienzo soporta geometrías arbitrarias
  // (curvas, escenarios, etc.). Cada asiento lleva fila + número.
  await prisma.seat.createMany({
    data: Array.from({ length: 20 }, (_, i) => {
      const t = ((-45 + (i * 90) / 19) * Math.PI) / 180;
      return {
        localityId: vip.id,
        label: String(i + 1),
        row: 'A',
        x: Math.round(320 + 300 * Math.sin(t)),
        y: Math.round(60 + 300 * (1 - Math.cos(t))),
      };
    }),
    skipDuplicates: true,
  });
  await prisma.locality.update({ where: { id: vip.id }, data: { capacity: 20 } });

  // Materializa el aforo GENERAL como filas `seats` (GA-*): la admisión general
  // se vende por cantidad asignando cupos concretos (anti-doble-venta).
  await prisma.seat.createMany({
    data: Array.from({ length: 100 }, (_, i) => ({
      localityId: general.id,
      label: `GA-${i + 1}`,
    })),
    skipDuplicates: true,
  });
}

async function main(): Promise<void> {
  await seedSettings();
  await seedFeeSchedule();
  await seedGateway();
  const users = await seedUsers();
  const categories = await seedCategories(users['admin@pasaeventos.com']);
  await seedDemoEvent(users['promotor@pasaeventos.com'], categories['Concierto']);

  const [settings, userCount, catCount, eventCount] = await Promise.all([
    prisma.setting.count(),
    prisma.user.count(),
    prisma.category.count(),
    prisma.event.count(),
  ]);
  console.log(
    `Seed OK → settings:${settings} users:${userCount} categories:${catCount} events:${eventCount}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
