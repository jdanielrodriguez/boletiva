import { PromoterStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  BASE_FIXED_FEES,
  GATEWAY_FEE_PCT,
  IVA_PCT,
  PLATFORM_FEE_PCT,
  toFeeString,
} from '../api/src/config/pricing-defaults';
import { makePrismaClient } from './prisma-client';
import { KB_SEED_ARTICLES } from './kb-seed-data';

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
      value: true,
      description: 'Habilita el soporte/chat (promotor ↔ asesor/admin). Activo por defecto.',
    },
    {
      key: 'promoter.can_feature_events',
      value: false,
      description: 'Permite a los promotores destacar su evento en el inicio (default false = oculto).',
    },
    { key: 'events.creation_enabled', value: true, description: 'Habilita la creación de eventos por promotores.' },
    { key: 'home.slider_enabled', value: true, description: 'Muestra el slider del inicio (false = siempre oculto).' },
    { key: 'seatmap.enabled', value: true, description: 'Habilita el uso del mapa de asientos.' },
    { key: 'advisors.enabled', value: true, description: 'Habilita el rol asesor (soporte).' },
    { key: 'advisors.maintenance', value: false, description: 'Mantenimiento solo para asesores (pantalla de acceso deshabilitado).' },
    { key: 'billing.maintenance', value: false, description: 'Mantenimiento de facturación (oculta la facturación por descuadres).' },
    {
      key: 'advisor.lock_enabled',
      value: true,
      description: 'Exigir desbloqueo por tiempo (aprobado por admin) para que un asesor mute datos',
    },
    {
      key: 'ux.click_delay_enabled',
      value: true,
      description: 'Muestra un breve indicador de carga al hacer clic (clientes/visitantes).',
    },
    {
      key: 'ux.click_delay_ms',
      value: 200,
      description: 'Duración (ms) del indicador de carga al hacer clic (si está activado). Default 200ms.',
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
  // Config de gateways POR ENTORNO. `SEED_REAL_GATEWAYS=true` (prod/alpha, lo fija el
  // deploy/db-seed) activa las pasarelas REALES; sin él (TEST + local por defecto) todo
  // corre con provider 'simulator' al 5% sin fijo → el precio CANÓNICO 129.68 y toda la
  // suite e2e siguen en verde. Los tests SIEMPRE usan simulador (jest.env fuerza el env).
  const realGw = ['1', 'true', 'yes', 'on'].includes(
    (process.env.SEED_REAL_GATEWAYS ?? '').toLowerCase(),
  );
  const gateways: Array<{
    name: string;
    provider: string;
    feePct: string;
    transactionFixedFee?: string;
    installmentRates?: Record<string, number>;
    installmentFixedFee?: string;
    installmentsEnabled?: boolean;
    sandbox: boolean;
    status?: 'active' | 'inactive';
    isPlatformDefault?: boolean;
  }> = realGw
    ? [
        // ── ALPHA/PROD: 3 pasarelas ACTIVAS + dLocal deshabilitada ──
        // PAGALO = default de plataforma (plan Premium del usuario: 4.25% + Q1.50, tarjeta de
        // PRUEBA en alpha; tokenización de NUESTRO lado). Provider real 'pagalo'.
        {
          name: 'Pagalo',
          provider: 'pagalo',
          feePct: '0.04250',
          transactionFixedFee: '1.50',
          sandbox: true, // PAGALO_ESTADO=sandbox en alpha
          status: 'active',
          isPlatformDefault: true,
        },
        // RECURRENTE = externa (checkout hospedado + webhook Svix). Tarifario plan empresa.
        {
          name: 'Recurrente',
          provider: 'recurrente',
          feePct: '0.04500',
          transactionFixedFee: '2.00',
          installmentRates: { '3': 0.08, '6': 0.09, '12': 0.1, '18': 0.14 },
          installmentFixedFee: '2.00',
          installmentsEnabled: true,
          sandbox: true,
          status: 'active',
        },
        // SIMULADOR (Sandbox): sigue disponible para pruebas internas.
        { name: 'Sandbox', provider: 'simulator', feePct: '0.05000', sandbox: true, status: 'active' },
        // dLocal DESHABILITADA (placeholder; ruta PCI-safe para el lanzamiento público).
        { name: 'dLocal', provider: 'dlocal', feePct: '0.03500', sandbox: true, status: 'inactive' },
      ]
    : [
        // ── TEST/LOCAL (canon): todo simulador 5%; default = Recurrente → 129.68 intacto ──
        {
          name: 'Recurrente',
          provider: 'simulator',
          feePct: '0.05000',
          installmentRates: { '3': 0.08, '6': 0.09, '12': 0.1, '18': 0.14 },
          installmentsEnabled: false,
          sandbox: true,
          isPlatformDefault: true,
        },
        // Pagalo/Sandbox activas y seleccionables, pero cobran por el SIMULADOR (canon 5%).
        { name: 'Pagalo', provider: 'simulator', feePct: '0.05000', sandbox: true, status: 'active' },
        { name: 'Sandbox', provider: 'simulator', feePct: '0.05000', sandbox: true },
        // dLocal deshabilitada también en local (placeholder).
        { name: 'dLocal', provider: 'dlocal', feePct: '0.03500', sandbox: true, status: 'inactive' },
      ];
  // La pasarela default depende del entorno (Pagalo en alpha, Recurrente en test-canon).
  const defaultName = realGw ? 'Pagalo' : 'Recurrente';
  for (const g of gateways) {
    await prisma.paymentGateway.upsert({
      where: { name: g.name },
      // El update resetea feePct/fijo/estado → reseed deja un estado PRISTINO (evita
      // arrastrar mutaciones de tarifa entre corridas de e2e).
      update: {
        // Incluye `provider`/`sandbox`/`installmentFixedFee` para que un reseed CAMBIE de
        // modo (simulador↔real) de forma limpia, no solo la tarifa.
        provider: g.provider,
        feePct: g.feePct,
        installmentRates: g.installmentRates ?? undefined,
        installmentFixedFee: g.installmentFixedFee ?? null,
        installmentsEnabled: g.installmentsEnabled ?? true,
        transactionFixedFee: g.transactionFixedFee ?? '0.00',
        minCostSharePct: '0.00000',
        sandbox: g.sandbox,
        status: g.status ?? 'active',
      },
      create: {
        name: g.name,
        provider: g.provider,
        feePct: g.feePct,
        transactionFixedFee: g.transactionFixedFee ?? '0.00',
        installmentRates: g.installmentRates,
        installmentFixedFee: g.installmentFixedFee ?? null,
        installmentsEnabled: g.installmentsEnabled ?? true,
        sandbox: g.sandbox,
        status: g.status ?? 'active',
      },
    });
  }
  // Default de plataforma dinámico: PAGALO en alpha/prod (SEED_REAL_GATEWAYS), RECURRENTE en
  // test/local (5% simulador → precio canónico 129.68 intacto). Una sola default (índice parcial).
  await prisma.$transaction([
    prisma.paymentGateway.updateMany({
      where: { isPlatformDefault: true, name: { not: defaultName } },
      data: { isPlatformDefault: false },
    }),
    prisma.paymentGateway.updateMany({
      where: { name: defaultName },
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
      // Asesor de soporte (rol advisor): hereda al admin MENOS la tab "Sistema";
      // muta con desbloqueo por link del admin (B2). Para probar el flujo de asesores.
      email: 'asesor@boletiva.com',
      firstName: 'Asesor',
      roles: [Role.advisor],
      // En PROD se inyecta fuerte por env (SEED_ASESOR_PASSWORD, ver db-seed.yml); `||`
      // (no `??`) cae a Password123 cuando la env llega vacía (CI/GH Actions).
      password: process.env.SEED_ASESOR_PASSWORD || 'Password123',
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
    {
      // 2º comprador: YA compró asientos en el evento demo (tribunas del estadio).
      // Sus asientos aparecen OCUPADOS para el cliente 1 → demuestra sold/pending
      // en el mapa (que dos personas no ven los mismos cupos libres).
      email: 'cliente2@boletiva.com',
      firstName: 'Ana',
      roles: [Role.buyer],
      password: process.env.SEED_BUYER2_PASSWORD || 'Password123',
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

/**
 * Rejilla de asientos (filas × columnas) en una región rectangular del "mundo".
 * Todas las zonas del evento comparten el MISMO espacio de coordenadas → juntas
 * forman el recinto (como en el mapa de VivaTicket del Estadio Cementos Progreso:
 * ESCENARIO arriba, Mesas AMEX/Ultra Fan al frente, Tribuna izq + Preferencia der).
 */
function gridSeats(opts: {
  section: string;
  prefix: string;
  rows: number;
  cols: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
}): Array<{ label: string; row: string; section: string; x: number; y: number }> {
  const out: Array<{ label: string; row: string; section: string; x: number; y: number }> = [];
  for (let r = 0; r < opts.rows; r++) {
    for (let c = 0; c < opts.cols; c++) {
      out.push({
        label: `${opts.prefix}${r + 1}-${c + 1}`,
        row: `${opts.prefix}${r + 1}`,
        section: opts.section,
        x: opts.x0 + c * opts.dx,
        y: opts.y0 + r * opts.dy,
      });
    }
  }
  return out;
}

/**
 * Genera MESAS en rejilla: cada mesa tiene un centro y `seatsPerTable` sillas
 * alrededor (en círculo). Las sillas comparten `row = <prefix><nºmesa>` → el mapa
 * agrupa por mesa (dibuja la mesa al centroide) y cada silla como círculo alrededor.
 */
function tableClusterSeats(o: {
  section: string;
  prefix: string;
  tableRows: number;
  tableCols: number;
  seatsPerTable: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
}): Array<{ label: string; row: string; section: string; x: number; y: number }> {
  const out: Array<{ label: string; row: string; section: string; x: number; y: number }> = [];
  const R = 9; // radio de las sillas alrededor del centro de la mesa
  let t = 0;
  for (let r = 0; r < o.tableRows; r++) {
    for (let c = 0; c < o.tableCols; c++) {
      t++;
      const cx = o.x0 + c * o.dx;
      const cy = o.y0 + r * o.dy;
      const tableId = `${o.prefix}${t}`;
      for (let s = 0; s < o.seatsPerTable; s++) {
        const ang = ((-90 + s * (360 / o.seatsPerTable)) * Math.PI) / 180;
        out.push({
          label: `${tableId}-${s + 1}`,
          row: tableId,
          section: o.section,
          x: Math.round(cx + R * Math.cos(ang)),
          y: Math.round(cy + R * Math.sin(ang)),
        });
      }
    }
  }
  return out;
}

async function seedDemoEvent(
  promoterId: string,
  categoryId: string,
  buyer2Id: string,
): Promise<void> {
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

  // Salón real: Estadio Cementos Progreso (creado en seedHalls). Se enlaza al evento
  // y se prefijan dirección/coordenadas → flujo realista (evento en un recinto real).
  const hall = await prisma.hall.findFirst({ where: { name: 'Estadio Cementos Progreso' } });

  const event = await prisma.event.create({
    data: {
      promoterId,
      categoryId,
      name: 'Romeo Santos & Prince Royce en el Estadio Cementos Progreso',
      slug,
      description:
        'Una noche de bachata en el Estadio Cementos Progreso, zona 6. Elige tu zona en el ' +
        'mapa: Mesas AMEX y Ultra Fan frente al escenario, Tribuna y Preferencia laterales, ' +
        'o General. Acércate en el mapa (doble clic o rueda) para ver los asientos de cada zona.',
      hallId: hall?.id ?? null,
      address: hall?.address ?? 'Calzada José Milla y Vidaurre, Zona 6, Ciudad de Guatemala',
      lat: hall?.lat ?? 14.6469,
      lng: hall?.lng ?? -90.5389,
      startsAt,
      endsAt,
      status: 'published',
      // Destacado en el slider del inicio (GET /events/promoted).
      promotedPriority: 1,
    },
  });

  // Layout basado en el mapa REAL (VivaTicket, Estadio Cementos Progreso). Mundo
  // ~ x[0..1130] y[0..650]: ESCENARIO arriba; frente = Mesas AMEX Izq/Der + Ultra Fan
  // Izq/Der (con FOH al centro); laterales = Tribuna(+Platea) izq y Preferencia der;
  // abajo el arco GENERAL 1/2. Las DECORACIONES (escenario/FOH/PLATEA/etiquetas/cruces)
  // se guardan en SeatMap.layout → el frontend las dibuja en el canvas (se anclan).
  const decorations = {
    stage: { x: 335, y: 0, w: 460, h: 46, label: 'ESCENARIO' },
    blocks: [
      { x: 520, y: 150, w: 90, h: 70, label: 'FOH', fill: '#1e2a52' },
      { x: 540, y: 405, w: 50, h: 46, fill: '#1e2a52' },
      { x: 150, y: 420, w: 84, h: 60, label: 'PLATEA', fill: '#9aa0b0' },
      { x: 120, y: 505, w: 455, h: 120, label: 'GENERAL 1', fill: '#ecdcd2' },
      { x: 595, y: 505, w: 455, h: 120, label: 'GENERAL 2', fill: '#dfe4ee' },
    ],
    labels: [
      { x: 96, y: 320, text: 'TRIBUNA', rotation: -90, size: 16 },
      { x: 1075, y: 150, text: 'PREFERENCIA', rotation: 90, size: 16 },
    ],
    aids: [{ x: 565, y: 480 }, { x: 812, y: 96 }, { x: 812, y: 235 }],
  };
  await prisma.seatMap.create({
    data: {
      eventId: event.id,
      version: 1,
      name: 'Estadio Cementos Progreso',
      width: 1130,
      height: 650,
      active: true,
      layout: decorations as object,
    },
  });

  // MESAS (AMEX + Ultra Fan) = clústeres (mesa central + 4 sillas alrededor).
  // TRIBUNA/PREFERENCIA = rejilla de sillas mirando al escenario.
  const zones: Array<{
    name: string; slug: string; net: number;
    seats: Array<{ label: string; row: string; section: string; x: number; y: number }>;
  }> = [
    { name: 'Mesas AMEX Izquierda', slug: 'mesas-amex-izq', net: 250, seats: tableClusterSeats({ section: 'AMEX Izq', prefix: 'AI', tableRows: 4, tableCols: 4, seatsPerTable: 4, x0: 300, y0: 100, dx: 52, dy: 48 }) },
    { name: 'Mesas AMEX Derecha', slug: 'mesas-amex-der', net: 250, seats: tableClusterSeats({ section: 'AMEX Der', prefix: 'AD', tableRows: 4, tableCols: 4, seatsPerTable: 4, x0: 610, y0: 100, dx: 52, dy: 48 }) },
    { name: 'Mesas Ultra Fan Izquierda', slug: 'mesas-ultrafan-izq', net: 180, seats: tableClusterSeats({ section: 'Ultra Fan Izq', prefix: 'UI', tableRows: 4, tableCols: 4, seatsPerTable: 4, x0: 300, y0: 300, dx: 52, dy: 48 }) },
    { name: 'Mesas Ultra Fan Derecha', slug: 'mesas-ultrafan-der', net: 180, seats: tableClusterSeats({ section: 'Ultra Fan Der', prefix: 'UD', tableRows: 4, tableCols: 4, seatsPerTable: 4, x0: 610, y0: 300, dx: 52, dy: 48 }) },
    { name: 'Tribuna', slug: 'tribuna', net: 120, seats: gridSeats({ section: 'Tribuna', prefix: 'T', rows: 13, cols: 3, x0: 150, y0: 95, dx: 28, dy: 24 }) },
    { name: 'Preferencia', slug: 'preferencia', net: 150, seats: gridSeats({ section: 'Preferencia', prefix: 'P', rows: 13, cols: 3, x0: 945, y0: 95, dx: 28, dy: 24 }) },
  ];
  const localityByName: Record<string, { id: string }> = {};
  for (const z of zones) {
    const seats = z.seats;
    const loc = await prisma.locality.create({
      data: { eventId: event.id, name: z.name, slug: z.slug, kind: 'seated', desiredNet: z.net },
    });
    await prisma.seat.createMany({ data: seats.map((s) => ({ localityId: loc.id, ...s })), skipDuplicates: true });
    await prisma.locality.update({ where: { id: loc.id }, data: { capacity: seats.length } });
    localityByName[z.name] = loc;
  }

  // ── General 1 / General 2 (admisión GENERAL, el arco inferior en U): sin mapa, se
  // venden por cantidad. El E2E aterriza en "General 1" (clickLocTab('General')). ──
  for (const [name, slug] of [['General 1', 'general-1'], ['General 2', 'general-2']] as const) {
    const g = await prisma.locality.create({
      data: { eventId: event.id, name, slug, kind: 'general', desiredNet: 75, capacity: 120 },
    });
    await prisma.seat.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({ localityId: g.id, label: `${slug}-GA-${i + 1}` })),
      skipDuplicates: true,
    });
  }

  // ── El 2º cliente YA compró asientos (varias zonas) → salen OCUPADOS/azules para su
  // dueño y OCUPADOS para el cliente 1 (demuestra sold compartido). ──
  await sellSeatsToBuyer(buyer2Id, event.id, [
    { localityId: localityByName['Mesas AMEX Derecha'].id, labels: ['AD1-1', 'AD1-2', 'AD2-1'], net: 250 },
    { localityId: localityByName['Preferencia'].id, labels: ['P1-1', 'P1-2'], net: 150 },
    { localityId: localityByName['Mesas Ultra Fan Izquierda'].id, labels: ['UI1-1', 'UI1-2', 'UI3-4'], net: 180 },
  ]);
}

/**
 * Marca un conjunto de asientos como VENDIDOS a un comprador: crea una orden `paid`
 * con sus ítems (snapshot mínimo pero coherente) + un boleto por ítem, y pone el
 * `seat.status='sold'` (que es lo que lee `availability`). Idempotente-safe para el
 * seed (se llama solo al crear el evento). Genera media best-effort del boleto.
 */
async function sellSeatsToBuyer(
  buyerId: string,
  eventId: string,
  groups: Array<{ localityId: string; labels: string[]; net: number }>,
): Promise<void> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return;
  // Precio de comprador aproximado por asiento (gross-up ~1.3× el neto) — el seed no
  // pasa por el PricingEngine; basta con un snapshot coherente para la caja/boletos.
  const priceOf = (net: number) => Math.round(net * 1.3 * 100) / 100;

  let orderNet = 0;
  let orderTotal = 0;
  const lines: Array<{ localityId: string; seatId: string; label: string; net: number; total: number }> = [];
  for (const g of groups) {
    const seats = await prisma.seat.findMany({ where: { localityId: g.localityId, label: { in: g.labels } } });
    for (const s of seats) {
      const total = priceOf(g.net);
      lines.push({ localityId: g.localityId, seatId: s.id, label: s.label, net: g.net, total });
      orderNet += g.net;
      orderTotal += total;
    }
  }
  if (lines.length === 0) return;

  const platformFee = Math.round(orderNet * 0.1 * 100) / 100;
  const taxableBase = Math.round((orderNet + platformFee) * 100) / 100;
  const iva = Math.round(taxableBase * 0.12 * 100) / 100;
  const gatewayFee = Math.round((orderTotal - taxableBase - iva) * 100) / 100;

  const order = await prisma.order.create({
    data: {
      buyerId,
      eventId,
      status: 'paid',
      net: orderNet.toFixed(2),
      platformFee: platformFee.toFixed(2),
      fixedFees: '0.00',
      taxableBase: taxableBase.toFixed(2),
      iva: iva.toFixed(2),
      gatewayFee: (gatewayFee > 0 ? gatewayFee : 0).toFixed(2),
      total: orderTotal.toFixed(2),
      paidAt: new Date('2026-11-01T12:00:00-06:00'),
    },
  });

  for (const ln of lines) {
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        localityId: ln.localityId,
        seatId: ln.seatId,
        label: ln.label,
        net: ln.net.toFixed(2),
        total: ln.total.toFixed(2),
        quote: {},
        quoteHash: `seed-demo-${ln.seatId}`,
        active: true,
      },
    });
    const ticket = await prisma.ticket.create({
      data: {
        orderItemId: item.id,
        orderId: order.id,
        eventId,
        localityId: ln.localityId,
        seatId: ln.seatId,
        ownerId: buyerId,
        status: 'valid',
        serial: `SEED-DEMO-${ln.label}`,
        totpSecret: 'seed',
        signature: 'seed',
        signingKeyId: 'seed',
      },
    });
    // El estado que lee `availability`: sin esto el asiento seguiría `available`.
    await prisma.seat.update({ where: { id: ln.seatId }, data: { status: 'sold' } });
    await generateSeedTicketMedia({
      ticketId: ticket.id,
      eventId,
      serial: ticket.serial,
      eventName: event.name,
      startsAt: event.startsAt,
    });
  }
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
  const tickets = await Promise.all(
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

  // Genera la MEDIA (QR PNG + PDF) de los boletos demo para que la cuenta muestre el
  // QR de verdad (una compra real la genera async por la cola MEDIA; el seed los inserta
  // directo, así que replicamos aquí el objeto en storage). Best-effort: si el storage
  // no está disponible, el seed no falla.
  for (const t of tickets) {
    await generateSeedTicketMedia({
      ticketId: t.id,
      eventId: event.id,
      serial: t.serial,
      eventName: event.name,
      startsAt: event.startsAt,
    });
  }
}

/**
 * Genera y sube la media (QR PNG + PDF sencillo) de un boleto demo a storage, y marca
 * el boleto como listo. Solo aplica a LocalStack (dev): en GCS/prod se omite para no
 * subir objetos de prueba. Nunca lanza (el seed no debe caerse por el storage).
 */
async function generateSeedTicketMedia(t: {
  ticketId: string;
  eventId: string;
  serial: string;
  eventName: string;
  startsAt: Date;
}): Promise<void> {
  const endpoint = process.env.S3_ENDPOINT ?? '';
  const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT ?? '';
  // Solo LocalStack/dev (endpoint local): evita subir demo a un bucket real.
  const isLocal = /localstack|localhost|127\.0\.0\.1/.test(endpoint) || /localhost|127\.0\.0\.1/.test(publicEndpoint);
  if (process.env.STORAGE_PROVIDER !== 's3' || !isLocal) return;

  try {
    const bucket = process.env.S3_BUCKET as string;
    const s3 = new S3Client({
      endpoint,
      region: process.env.S3_REGION ?? 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY as string,
      },
    });

    // QR estático (instantánea): `PE1.<serial>.<code>` — igual formato que producción.
    const payload = `PE1.${t.serial}.000000`;
    const qrPng = await QRCode.toBuffer(payload, { type: 'png', width: 420, margin: 1 });

    // PDF mínimo con marca + QR embebido (para el botón de descarga).
    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 48 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.fontSize(22).fillColor('#7c3aed').text('Boletiva', { align: 'left' });
      doc.moveDown(0.5).fontSize(16).fillColor('#1a1a2e').text(t.eventName);
      doc.moveDown(0.2).fontSize(11).fillColor('#6b6b76').text(t.startsAt.toISOString());
      doc.moveDown(0.2).text(`Serial: ${t.serial}`);
      doc.image(qrPng, { fit: [220, 220] });
      doc.end();
    });

    const base = `tickets/${t.eventId}/${t.ticketId}`;
    const qrKey = `${base}/qr.png`;
    const pdfKey = `${base}/ticket.pdf`;
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: qrKey, Body: qrPng, ContentType: 'image/png' }));
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: pdfKey, Body: pdf, ContentType: 'application/pdf' }));
    await prisma.ticket.update({
      where: { id: t.ticketId },
      data: { qrKey, pdfKey, mediaReadyAt: new Date() },
    });
  } catch (e) {
    // best-effort: el seed no debe fallar por el storage.
    console.warn(`[seed] no se pudo generar media del boleto ${t.serial}: ${(e as Error).message}`);
  }
}

/** Tarjeta de prueba (Visa •4242) para el cliente semilla → probar checkout sin tener
 *  que registrar tarjeta. `token` es un placeholder (el PAN real nunca toca el backend). */
async function seedDemoCard(buyerId: string): Promise<void> {
  const existing = await prisma.savedCard.findFirst({ where: { userId: buyerId } });
  if (existing) return;
  await prisma.savedCard.create({
    data: { userId: buyerId, brand: 'visa', last4: '4242', token: 'seed-tok-visa-4242', isDefault: true },
  });
}

/** Notificaciones de muestra (campanita) para cliente y promotor: una leída y una sin leer. */
async function seedDemoNotifications(buyerId: string, promoterId: string): Promise<void> {
  if ((await prisma.notification.count()) > 0) return;
  await prisma.notification.createMany({
    data: [
      {
        userId: buyerId,
        type: 'ticket',
        title: '¡Tus boletos están listos!',
        body: 'Tu compra de "Concierto de Prueba" fue confirmada. Ya puedes verlos en Mi cuenta.',
        resourceType: 'order',
      },
      {
        userId: buyerId,
        type: 'system',
        title: 'Bienvenido a Boletiva',
        body: 'Explora eventos y compra tus boletos con QR dinámico.',
        readAt: new Date(),
      },
      {
        userId: promoterId,
        type: 'promoter',
        title: 'Tu evento recibió ventas',
        body: 'Revisa el dashboard para ver tu recaudación en vivo.',
        resourceType: 'event',
      },
    ],
  });
}

/** Tickets de soporte de muestra (para ver la bandeja del agente y la vista del promotor). */
async function seedDemoSupport(promoterId: string, adminId: string): Promise<void> {
  if ((await prisma.supportTicket.count()) > 0) return;
  // Ticket 1: abierto, con mensaje del promotor (aparece en la cola sin-asignar).
  const t1 = await prisma.supportTicket.create({
    data: { promoterId, subject: 'No veo mi liquidación del evento', category: 'payments_settlement', priority: 'high', status: 'new' },
  });
  await prisma.supportMessage.create({
    data: { ticketId: t1.id, senderId: promoterId, senderRole: Role.promoter, body: 'Hola, mi evento ya terminó pero no aparece la liquidación. ¿Me ayudan?' },
  });
  // Ticket 2: resuelto, con respuesta del admin (aparece en "resueltos").
  const t2 = await prisma.supportTicket.create({
    data: { promoterId, subject: '¿Cómo cambio la pasarela de un evento?', category: 'technical', priority: 'medium', status: 'resolved', assignedToId: adminId, resolvedAt: new Date() },
  });
  await prisma.supportMessage.createMany({
    data: [
      { ticketId: t2.id, senderId: promoterId, senderRole: Role.promoter, body: 'No encuentro dónde cambiar la pasarela.' },
      { ticketId: t2.id, senderId: adminId, senderRole: Role.admin, body: 'En el editor del evento, pestaña Configuración, mientras esté en borrador o suspendido. ¡Saludos!' },
    ],
  });
}

async function seedKbArticles(authorId?: string): Promise<void> {
  // Base de Conocimientos (T6): artículos publicados iniciales del FAQ (≥5 por categoría),
  // en `prisma/kb-seed-data.ts`. Idempotente por slug.
  const articles = KB_SEED_ARTICLES;
  for (const a of articles) {
    const answerText = a.answerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    await prisma.kbArticle.upsert({
      where: { slug: a.slug },
      update: {},
      create: {
        slug: a.slug,
        question: a.question,
        answerHtml: a.answerHtml,
        answerText,
        category: a.category,
        locale: 'es',
        status: 'published',
        visibility: a.visibility ?? 'public',
        tags: a.tags,
        sortOrder: a.sortOrder ?? 0,
        publishedAt: new Date(),
        createdById: authorId,
      },
    });
  }
}

async function main(): Promise<void> {
  await seedSettings();
  await seedFeeSchedule();
  await seedGateway();
  const templates = await seedSeatTemplates();
  await seedHalls(templates['rows']);
  const users = await seedUsers();
  const categories = await seedCategories(users['admin@boletiva.com']);
  await seedDemoEvent(
    users['promotor@boletiva.com'],
    categories['Concierto'],
    users['cliente2@boletiva.com'],
  );
  await seedPastSoldEvent(
    users['promotor@boletiva.com'],
    categories['Concierto'],
    users['cliente@boletiva.com'],
  );
  await seedKbArticles(users['admin@boletiva.com']);
  await seedDemoCard(users['cliente@boletiva.com']);
  await seedDemoNotifications(users['cliente@boletiva.com'], users['promotor@boletiva.com']);
  await seedDemoSupport(users['promotor@boletiva.com'], users['admin@boletiva.com']);

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
