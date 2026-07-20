import { PromoterStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  BASE_FIXED_FEES,
  GATEWAY_FEE_PCT,
  IVA_PCT,
  PLATFORM_FEE_PCT,
  toFeeString,
} from '../api/src/config/pricing-defaults';
import { makePrismaClient } from './prisma-client';

const prisma = makePrismaClient();

/**
 * Seed base (BASELINE MÍNIMA v3.8): SOLO los datos funcionales imprescindibles para
 * validar la plataforma — configuración del sistema, fee_schedule v1, pasarelas
 * (Sandbox default), plantillas y salones demo, los 3 usuarios semilla
 * (admin/promotor aprobado/cliente), categorías y UN evento demo publicado con
 * localidades y asientos. Idempotente. Es la baseline a la que el globalTeardown de
 * los e2e re-siembra la BD al terminar cada corrida (staging/prod no guardan data de
 * test). NO agregar aquí data de prueba masiva; eso vive en seed-stadium (load test).
 */
async function seedSettings(): Promise<void> {
  const defaults: Array<{ key: string; value: unknown; description: string }> = [
    {
      key: 'pricing.platform_fee_pct',
      value: PLATFORM_FEE_PCT,
      description: 'Comisión de plataforma sobre el neto del promotor (perilla única: pricing-defaults.ts)',
    },
    {
      key: 'pricing.gateway_fee_pct',
      value: GATEWAY_FEE_PCT,
      description: 'Comisión de la pasarela sobre el total cobrado (0.05 = 5%)',
    },
    {
      key: 'pricing.iva_pct',
      value: IVA_PCT,
      description: 'IVA Guatemala sobre la base gravable (neto + comisión plataforma)',
    },
    {
      key: 'wallet.withdraw_fee_promoter_pct',
      value: 0.05,
      description: 'Comisión de retiro de saldo interno para promotores (5%)',
    },
    {
      key: 'wallet.withdraw_fee_user_pct',
      value: 0,
      description: 'Comisión de retiro para usuarios (0 = el cliente no retira, sin cargo)',
    },
    {
      key: 'transfer.max_per_ticket_default',
      value: 1,
      description: 'Máximo de transferencias por boleto por defecto',
    },
    {
      key: 'costshare.default_pct',
      value: 0,
      description:
        'Colaboración por defecto del promotor con gastos EXTRA (Ola 6.6: 0 = no colabora; el admin la sube a pedido para habilitarle cuotas/pasarelas premium)',
    },
    {
      key: 'installments.min_cost_share_pct',
      value: 0.3,
      description:
        'Cost-share mínimo del promotor para habilitar CUOTAS a sus compradores (0.3 = 30%)',
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
    {
      key: 'i18n.allow_visitor_switch',
      value: false,
      description: 'Permitir que un visitante (sin sesión) cambie el idioma de la UI',
    },
    {
      key: 'home.show_categories',
      value: false,
      description: 'Mostrar las categorías en la página principal (inicio)',
    },
    {
      key: 'theme.slot.noche',
      value: 'pulso',
      description: 'Tema asignado a la franja NOCHE (el admin puede voltear día↔noche)',
    },
    {
      key: 'theme.slot.dia',
      value: 'marquesina',
      description: 'Tema asignado a la franja DÍA (el admin puede voltear día↔noche)',
    },
    {
      key: 'theme.default_franja',
      value: 'dia',
      description: 'Franja por defecto (visitante o usuario sin preferencia)',
    },
    {
      key: 'theme.allow_visitor_switch',
      value: false,
      description: 'Mostrar el botón de cambio de tema (día/noche) a todos (false = solo admin)',
    },
    // Premium / Asesor / Chat (B1/B2/B3) — apagados por defecto (beneficios para todos).
    {
      key: 'premium.enabled',
      value: false,
      description: 'Interruptor maestro del perfil premium (false = beneficios para todos los promotores)',
    },
    {
      key: 'premium.trial_enabled',
      value: false,
      description: 'Habilita la prueba gratis de premium (solo con premium.enabled=true)',
    },
    {
      key: 'premium.trial_days',
      value: 7,
      description: 'Días de la prueba gratis de premium',
    },
    {
      key: 'chat.enabled',
      value: false,
      description: 'Habilita el chat de soporte (promotor premium ↔ asesor/admin)',
    },
    {
      key: 'advisor.lock_enabled',
      value: true,
      description: 'Exigir desbloqueo por tiempo (aprobado por admin) para que un asesor mute datos',
    },
  ];
  for (const s of defaults) {
    // BASELINE autoritativa: el seed impone SIEMPRE el valor deseado (update de
    // `value`), no solo la descripción. Un `make seed` deja la config exactamente
    // como aquí (antes solo tocaba la descripción → los valores viejos quedaban).
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { value: s.value as object, description: s.description },
      create: { key: s.key, value: s.value as object, description: s.description },
    });
  }
}

/** Tabla de comisiones v1 (activa), coherente con los settings de precios. */
async function seedFeeSchedule(): Promise<void> {
  // ÚNICA perilla: lee de pricing-defaults.ts (mismo valor que el setting). UPSERT del v1
  // → un reseed SIEMPRE deja el schedule activo coherente con la perilla (si ya existía a
  // 10% y bajamos la perilla a 5%, el reseed lo actualiza; antes se saltaba y quedaba viejo).
  const data = {
    platformFeePct: toFeeString(PLATFORM_FEE_PCT),
    gatewayFeePct: toFeeString(GATEWAY_FEE_PCT),
    ivaPct: toFeeString(IVA_PCT),
    fixedFees: BASE_FIXED_FEES.toFixed(2),
    active: true,
  };
  const existing = await prisma.feeSchedule.findFirst({ where: { version: 1 } });
  if (existing) {
    await prisma.feeSchedule.update({ where: { id: existing.id }, data });
  } else {
    await prisma.feeSchedule.create({ data: { version: 1, label: 'Comisiones base (seed)', ...data } });
  }
}

/**
 * Pasarelas de pago (alpha/beta corren sobre el simulador webhook-first).
 * Recurrente = default de plataforma con pago en CUOTAS (Visacuotas/Mastercuotas:
 * 3→8% · 6→9% · 12→10% · 18→14%, +Q2 fijo — tarifario real). Ola 6.6: el Q2 es el
 * FIJO POR TRANSACCIÓN (`transactionFixedFee`), aplica a TODO cobro (1 pago y
 * cuotas); al combinar N boletos en 1 transacción la pasarela cobra el fijo una
 * vez y la plataforma captura el surplus. Pagalo = alternativa sin cuotas ni fijo.
 * Sandbox (fijo 0) se conserva → su precio base 129.68 queda intacto. Recurrente,
 * al llevar Q2, sube levemente su precio de 1 pago (COGS real). El `provider` real
 * se enchufa detrás del mismo puerto cuando lleguen credenciales. Idempotente.
 * `minCostSharePct` = 0 en todas (Recurrente es la default → SIEMPRE disponible,
 * edge 5). PayPal (a futuro) llevará 0.50.
 */
async function seedGateway(): Promise<void> {
  const gateways: Array<{
    name: string;
    provider: string;
    feePct: string;
    transactionFixedFee?: string;
    installmentRates?: Record<string, number>;
    sandbox: boolean;
    status?: 'active' | 'inactive';
  }> = [
    {
      name: 'Recurrente',
      provider: 'simulator',
      feePct: '0.05000',
      // En producción Recurrente cobra Q2 fijo por transacción; en seed/demo se deja
      // en 0 para preservar el precio canónico (129.68) que usan los e2e generales.
      // El mecanismo del fijo + surplus se prueba con pasarelas dedicadas en los
      // e2e de cuotas y de Ola 6.6.
      transactionFixedFee: '0.00',
      installmentRates: { '3': 0.08, '6': 0.09, '12': 0.1, '18': 0.14 },
      sandbox: true,
    },
    // Pagalo INACTIVA por decisión de negocio (deuda pendiente con Pagalo): no debe
    // ofrecerse hasta nuevo aviso. Sigue seleccionable solo si el admin la reactiva.
    { name: 'Pagalo', provider: 'simulator', feePct: '0.05000', sandbox: true, status: 'inactive' },
    { name: 'Sandbox', provider: 'simulator', feePct: '0.05000', sandbox: true },
  ];
  for (const g of gateways) {
    await prisma.paymentGateway.upsert({
      where: { name: g.name },
      // El update resetea feePct/fijo/estado → reseed deja un estado PRISTINO (evita
      // arrastrar mutaciones de tarifa entre corridas de e2e).
      update: {
        feePct: g.feePct,
        installmentRates: g.installmentRates ?? undefined,
        transactionFixedFee: g.transactionFixedFee ?? '0.00',
        minCostSharePct: '0.00000',
        status: g.status ?? 'active',
      },
      create: {
        name: g.name,
        provider: g.provider,
        feePct: g.feePct,
        transactionFixedFee: g.transactionFixedFee ?? '0.00',
        installmentRates: g.installmentRates,
        sandbox: g.sandbox,
        status: g.status ?? 'active',
      },
    });
  }
  // Default de plataforma = RECURRENTE (5% sin fijo en seed → mismo precio canónico
  // 129.68 que Sandbox): es la pasarela real por defecto fuera de modo test. Los
  // usuarios de PRUEBA (isTestUser) quedan anclados a Sandbox por código
  // (events/payments.resolveGateway), así que en modo test se cobra por Sandbox.
  // Una sola default (índice parcial). Pagalo/Sandbox quedan seleccionables.
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

/**
 * Plantillas de asientos BUILT-IN (v3.5): registra las 4 pre-configuraciones que
 * hoy usa el editor (Filas rectas, Teatro curvo, Estadio, Mesas redondas) para que
 * el frontend las lea del backend. `isBuiltIn=true` → no editables/borrables por el
 * admin. Idempotente por nombre. `params` guarda los parámetros de generación.
 */
async function seedSeatTemplates(): Promise<Record<string, string>> {
  const builtins: Array<{
    name: string;
    kind: 'rows' | 'theater' | 'stadium' | 'tables';
    hint: string;
    icon: string;
    params: Record<string, number>;
  }> = [
    {
      name: 'Filas rectas',
      kind: 'rows',
      hint: '8 filas × 12 asientos alineados',
      icon: '<svg viewBox="0 0 40 40" width="40" height="40"><g fill="#7b5cff"><rect x="6" y="8" width="28" height="4" rx="2"/><rect x="6" y="18" width="28" height="4" rx="2"/><rect x="6" y="28" width="28" height="4" rx="2"/></g></svg>',
      params: { rows: 8, cols: 12 },
    },
    {
      name: 'Teatro (curvo)',
      kind: 'theater',
      hint: 'Filas curvadas hacia el escenario',
      icon: '<svg viewBox="0 0 40 40" width="40" height="40"><g fill="none" stroke="#7b5cff" stroke-width="4" stroke-linecap="round"><path d="M6 14 Q20 8 34 14"/><path d="M6 24 Q20 18 34 24"/><path d="M6 34 Q20 28 34 34"/></g></svg>',
      params: { rows: 8, cols: 14, curve: 0.5 },
    },
    {
      name: 'Estadio',
      kind: 'stadium',
      hint: 'Gradas en los cuatro lados de la cancha',
      icon: '<svg viewBox="0 0 40 40" width="40" height="40"><rect x="4" y="4" width="32" height="32" rx="6" fill="none" stroke="#7b5cff" stroke-width="4"/><rect x="14" y="14" width="12" height="12" rx="2" fill="#7b5cff" opacity="0.4"/></svg>',
      params: { cols: 12, rowsPerBlock: 3 },
    },
    {
      name: 'Mesas redondas',
      kind: 'tables',
      hint: '6 mesas de 8 asientos',
      icon: '<svg viewBox="0 0 40 40" width="40" height="40"><g fill="#7b5cff"><circle cx="12" cy="12" r="5"/><circle cx="28" cy="12" r="5"/><circle cx="12" cy="28" r="5"/><circle cx="28" cy="28" r="5"/></g></svg>',
      params: { tables: 6, perTable: 8, radius: 46 },
    },
  ];
  const ids: Record<string, string> = {};
  for (const b of builtins) {
    const existing = await prisma.seatTemplate.findFirst({
      where: { name: b.name, isBuiltIn: true },
    });
    const data = {
      name: b.name,
      kind: b.kind,
      layoutJson: { hint: b.hint, icon: b.icon },
      params: b.params,
      isBuiltIn: true,
      status: 'published' as const, // built-ins visibles para el promotor (v3.7)
    };
    const tpl = existing
      ? await prisma.seatTemplate.update({ where: { id: existing.id }, data })
      : await prisma.seatTemplate.create({ data });
    ids[b.kind] = tpl.id;
  }
  return ids;
}

/** Salones/venues demo con coordenadas reales de Guatemala. Idempotente por nombre. */
async function seedHalls(seatTemplateId?: string): Promise<void> {
  const halls: Array<{
    name: string;
    address: string;
    lat: number;
    lng: number;
    city: string;
    withTemplate?: boolean;
  }> = [
    {
      name: 'Teatro Nacional Miguel Ángel Asturias',
      address: '24 Calle 3-81, Zona 1',
      lat: 14.6139,
      lng: -90.5178,
      city: 'Ciudad de Guatemala',
      withTemplate: true,
    },
    {
      name: 'Estadio Cementos Progreso',
      address: 'Calzada José Milla y Vidaurre, Zona 6',
      lat: 14.6469,
      lng: -90.5389,
      city: 'Ciudad de Guatemala',
    },
    {
      name: 'Parque de la Industria — Gran Salón',
      address: 'Calzada Atanasio Tzul, Zona 12',
      lat: 14.6018,
      lng: -90.5107,
      city: 'Ciudad de Guatemala',
    },
  ];
  for (const h of halls) {
    const existing = await prisma.hall.findFirst({ where: { name: h.name } });
    const data = {
      name: h.name,
      address: h.address,
      lat: h.lat,
      lng: h.lng,
      city: h.city,
      seatTemplateId: h.withTemplate ? seatTemplateId ?? null : null,
      status: 'published' as const, // salones demo visibles para el promotor (v3.7)
    };
    if (existing) {
      await prisma.hall.update({ where: { id: existing.id }, data });
    } else {
      await prisma.hall.create({ data });
    }
  }
}

async function seedUsers() {
  // Contraseñas por usuario. Default 'Password123' (local/dev/test/CI — los e2e lo
  // hardcodean). En PROD se inyectan fuertes por env (SEED_*_PASSWORD, ver db-seed.yml
  // + docs). Al re-correr el seed, el `update` de abajo REESCRIBE la contraseña.
  const users: Array<{
    email: string;
    firstName: string;
    roles: Role[];
    password: string;
    promoterStatus?: PromoterStatus;
    costSharePct?: number;
  }> = [
    {
      email: 'admin@boletiva.com',
      firstName: 'Admin',
      roles: [Role.admin],
      // `||` (no `??`): en CI/GH Actions una env sin secreto llega como '' (cadena
      // vacía), que `??` NO atraparía → contraseña vacía. `||` cae a Password123.
      password: process.env.SEED_ADMIN_PASSWORD || 'Password123',
    },
    {
      email: 'promotor@boletiva.com',
      firstName: 'Promotor',
      roles: [Role.promoter],
      password: process.env.SEED_PROMOTER_PASSWORD || 'Password123',
      promoterStatus: PromoterStatus.approved, // ya autorizado (puede operar)
      // Demo: colabora 50% → habilita CUOTAS y pasarelas premium en sus eventos
      // (con el default 0 no las ofrecería). Ola 6.6.
      costSharePct: 0.5,
    },
    {
      email: 'cliente@boletiva.com',
      firstName: 'Cliente',
      roles: [Role.buyer],
      password: process.env.SEED_BUYER_PASSWORD || 'Password123',
    },
  ];
  const created: Record<string, string> = {};
  for (const u of users) {
    const promoter =
      u.promoterStatus === PromoterStatus.approved
        ? { promoterStatus: PromoterStatus.approved, promoterDecidedAt: new Date() }
        : {};
    const costShare = u.costSharePct !== undefined ? { costSharePct: u.costSharePct } : {};
    const passwordHash = await bcrypt.hash(u.password, 12);
    const user = await prisma.user.upsert({
      where: { email: u.email },
      // Re-correr el seed REESCRIBE la contraseña (para recuperar acceso en prod).
      update: { roles: u.roles, passwordHash, emailVerifiedAt: new Date(), ...promoter, ...costShare },
      create: {
        email: u.email,
        firstName: u.firstName,
        passwordHash,
        roles: u.roles,
        emailVerifiedAt: new Date(), // usuarios semilla ya verificados
        ...promoter,
        ...costShare,
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
  const startsAt = new Date('2026-12-04T20:00:00-06:00');
  const endsAt = new Date('2026-12-04T23:00:00-06:00');
  const existing = await prisma.event.findUnique({ where: { slug } });
  if (existing) {
    // Higiene E2E: una corrida puede dejar el demo `suspended`/`cancelled` (o con fecha
    // pasada). El reseed lo RESTAURA a published + destacado + fecha futura para que el
    // catálogo/hero no queden vacíos en la siguiente corrida (antes: `return` sin tocar).
    await prisma.event.update({
      where: { slug },
      data: { status: 'published', promotedPriority: 1, startsAt, endsAt },
    });
    return;
  }

  const event = await prisma.event.create({
    data: {
      promoterId,
      categoryId,
      name: 'Evento Demo Boletiva',
      slug,
      description: 'Evento de ejemplo generado por el seed.',
      address: 'Ciudad de Guatemala',
      lat: 14.6349,
      lng: -90.5069,
      startsAt: new Date('2026-12-04T20:00:00-06:00'),
      endsAt: new Date('2026-12-04T23:00:00-06:00'),
      status: 'published',
      // Destacado en el slider del inicio (GET /events/promoted).
      promotedPriority: 1,
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

/**
 * Evento PASADO ya concluido (endsAt en el pasado) con boletos PAGADOS por el cliente.
 * Sirve para demostrar la LIQUIDACIÓN de caja sin tener que suspender un evento: un
 * evento publicado cuya fecha ya pasó es elegible para `settlement/finalize`. Deja el
 * snapshot financiero en las órdenes (server-authoritative) para que la liquidación
 * transfiera el neto del promotor; los boletos aparecen en "Boletos pasados" del cliente.
 * NOTA: no pre-asienta el pago en el ledger (el seed no usa LedgerService); al finalizar,
 * el ledger registra el traslado del neto → wallet (chain válido). Idempotente por slug.
 */
async function seedPastSoldEvent(
  promoterId: string,
  categoryId: string,
  buyerId: string,
): Promise<void> {
  const slug = 'evento-pasado-liquidable';
  if (await prisma.event.findUnique({ where: { slug } })) return;

  const event = await prisma.event.create({
    data: {
      promoterId,
      categoryId,
      name: 'Concierto de Prueba (concluido)',
      slug,
      description: 'Evento ya concluido con ventas, listo para generar la liquidación.',
      address: 'Ciudad de Guatemala',
      lat: 14.6349,
      lng: -90.5069,
      startsAt: new Date('2026-06-01T20:00:00-06:00'),
      endsAt: new Date('2026-06-01T23:00:00-06:00'),
      status: 'published', // concluido por FECHA (endsAt pasado) → elegible para liquidar
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
  await prisma.seat.createMany({
    data: Array.from({ length: 100 }, (_, i) => ({ localityId: general.id, label: `GA-${i + 1}` })),
    skipDuplicates: true,
  });

  // Orden PAGADA del cliente: 2 boletos generales. Snapshot coherente
  // (total = net + platformFee + fixedFees + iva + gatewayFee).
  const perTicket = { net: 75, platformFee: 7.5, iva: 9.9, gatewayFee: 5.1, total: 97.5 };
  const order = await prisma.order.create({
    data: {
      buyerId,
      eventId: event.id,
      status: 'paid',
      net: '150.00',
      platformFee: '15.00',
      fixedFees: '0.00',
      taxableBase: '165.00',
      iva: '19.80',
      gatewayFee: '10.20',
      total: '195.00',
      paidAt: new Date('2026-05-20T12:00:00-06:00'),
    },
  });
  const items = await Promise.all(
    [1, 2].map((n) =>
      prisma.orderItem.create({
        data: {
          orderId: order.id,
          localityId: general.id,
          label: `GA-${n}`,
          net: perTicket.net.toFixed(2),
          total: perTicket.total.toFixed(2),
          quote: {},
          quoteHash: `seed-past-${n}`,
          active: true,
        },
      }),
    ),
  );

  // Un boleto emitido por línea (aparecen en "Boletos pasados" del cliente).
  await Promise.all(
    items.map((it, i) =>
      prisma.ticket.create({
        data: {
          orderItemId: it.id,
          orderId: order.id,
          eventId: event.id,
          localityId: general.id,
          ownerId: buyerId,
          status: 'valid',
          serial: `SEED-PAST-${i + 1}`,
          totpSecret: 'seed',
          signature: 'seed',
          signingKeyId: 'seed',
        },
      }),
    ),
  );
}

async function main(): Promise<void> {
  await seedSettings();
  await seedFeeSchedule();
  await seedGateway();
  const templates = await seedSeatTemplates();
  await seedHalls(templates['rows']);
  const users = await seedUsers();
  const categories = await seedCategories(users['admin@boletiva.com']);
  await seedDemoEvent(users['promotor@boletiva.com'], categories['Concierto']);
  await seedPastSoldEvent(
    users['promotor@boletiva.com'],
    categories['Concierto'],
    users['cliente@boletiva.com'],
  );

  const [settings, userCount, catCount, eventCount, hallCount, tplCount] = await Promise.all([
    prisma.setting.count(),
    prisma.user.count(),
    prisma.category.count(),
    prisma.event.count(),
    prisma.hall.count(),
    prisma.seatTemplate.count(),
  ]);
  console.log(
    `Seed OK → settings:${settings} users:${userCount} categories:${catCount} events:${eventCount} halls:${hallCount} seatTemplates:${tplCount}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
