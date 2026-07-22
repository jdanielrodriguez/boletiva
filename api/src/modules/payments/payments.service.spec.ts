import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { createHmac } from 'crypto';
import { hmacSha256 } from '../../common/utils/crypto';

/**
 * Cobertura de RAMAS de PaymentsService (los BORDES; los flujos completos de pago
 * viven en los e2e de `payments`/`wallet-payment`/`refunds`/`installments`):
 *  - sin pasarela para cuotas / para completar por pasarela;
 *  - resolución de la pasarela default + recotización bloqueada por cost-share;
 *  - opciones de pago que descartan un plazo que el promotor no puede absorber;
 *  - webhook: carrera de duplicados (P2002) y tipo no manejado;
 *  - fail() sobre una orden ya pagada (idempotente).
 * Todas las dependencias mockeadas.
 */
describe('PaymentsService (ramas de borde, unit)', () => {
  const SECRET = 'wh-secret';
  // Secreto whsec_ para el webhook SVIX de Recurrente (la porción tras el prefijo es base64).
  const REC_KEY = Buffer.from('recurrente-webhook-key');
  const REC_WHSEC = `whsec_${REC_KEY.toString('base64')}`;
  const svixSign = (id: string, ts: string, body: string) =>
    'v1,' + createHmac('sha256', REC_KEY).update(`${id}.${ts}.${body}`).digest('base64');
  const dec = (n: number | string) => new Prisma.Decimal(n);

  const build = (providerOverride?: Record<string, unknown>) => {
    const prisma = {
      order: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      payment: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      paymentGateway: { findUnique: jest.fn() },
      event: { findUnique: jest.fn().mockResolvedValue({ promoter: { isTestUser: false } }) },
      webhookEvent: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      ledgerTransaction: { findFirst: jest.fn() },
      orderItem: { updateMany: jest.fn(), update: jest.fn() },
      seat: { updateMany: jest.fn() },
      // Resuelve los ops reales (como una tx): fulfill desestructura [, claim] del
      // updateMany condicional (pending→paid) → debe devolver su {count}.
      $transaction: jest.fn().mockImplementation((ops: unknown[]) => Promise.all(ops)),
    };
    const ledger = { walletBalance: jest.fn().mockResolvedValue(new Prisma.Decimal(0)), post: jest.fn() };
    const pricing = {
      paramsForRequote: jest.fn(),
      installmentRate: jest.fn(),
      resolveFeesForEvent: jest.fn().mockResolvedValue({ gatewayId: null }),
    };
    const gateways = {
      get: jest.fn(),
      platformDefault: jest.fn(),
      listActive: jest.fn(),
      sandboxGateway: jest.fn(),
    };
    const costShare = {
      effectivePct: jest.fn(),
      installmentsMinPct: jest.fn(),
      gatewayAllowed: jest.fn(),
      installmentsAllowed: jest.fn(),
    };
    const config = {
      get: jest.fn((k: string) =>
        k === 'payment.webhookSecret'
          ? SECRET
          : k === 'recurrente'
            ? { webhookSecret: REC_WHSEC }
            : undefined,
      ),
    };
    const queue = { enqueue: jest.fn() };
    const tickets = { revokeByOrder: jest.fn() };
    const stream = { emitOrder: jest.fn(), emitSeat: jest.fn(), emitWallet: jest.fn() };
    const provider = providerOverride ?? {
      name: 'sim',
      createPayment: jest.fn().mockResolvedValue({ paymentUrl: 'http://pay' }),
      scheduleAutoConfirm: jest.fn(),
    };
    const notifications = { emit: jest.fn().mockResolvedValue(undefined), emitToRoles: jest.fn().mockResolvedValue(undefined) };
    // Enrutamiento multi-pasarela: el servicio ahora usa un registro. El mock resuelve
    // SIEMPRE al `provider` de la prueba (equivale al modo forzado del simulador en test).
    const providers = { resolveFor: () => provider };
    const service = new PaymentsService(
      prisma as never,
      ledger as never,
      pricing as never,
      gateways as never,
      costShare as never,
      config as never,
      queue as never,
      tickets as never,
      stream as never,
      notifications as never,
      providers as never,
    );
    return { prisma, ledger, pricing, gateways, costShare, stream, provider, notifications, service };
  };

  const gwActive = (over: Record<string, unknown> = {}) => ({
    id: 'GWDEF',
    status: 'active',
    feePct: dec(0.05),
    transactionFixedFee: dec(0),
    ...over,
  });

  describe('initiate', () => {
    it('sin opts y con un intento pendiente ya existente → lo devuelve (idempotencia)', async () => {
      const { prisma, service } = build();
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        buyerId: 'u1',
        status: 'pending',
        feeGatewayId: null,
        total: '129.68',
        currency: 'GTQ',
      });
      prisma.payment.findFirst.mockResolvedValue({
        id: 'p1',
        providerRef: 'sim_r',
        status: 'pending',
        method: 'gateway',
        amount: dec('129.68'),
        walletAmount: dec(0),
      });
      const res = await service.initiate('o1', 'u1'); // sin opts → defaults
      expect(res.paymentId).toBe('p1');
    });

    it('orden ajena → 404 (IDOR)', async () => {
      const { prisma, service } = build();
      prisma.order.findUnique.mockResolvedValue({ id: 'o1', buyerId: 'otro', status: 'pending' });
      await expect(service.initiate('o1', 'u1', {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it('orden no pendiente → 409', async () => {
      const { prisma, service } = build();
      prisma.order.findUnique.mockResolvedValue({ id: 'o1', buyerId: 'u1', status: 'paid' });
      await expect(service.initiate('o1', 'u1', {})).rejects.toBeInstanceOf(ConflictException);
    });

    it('cobro 100% por pasarela → crea intento y agenda auto-confirm', async () => {
      const { prisma, gateways, provider, service } = build();
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        buyerId: 'u1',
        status: 'pending',
        feeGatewayId: 'GWDEF', // = gateway elegida → sin recotización
        total: '129.68',
        currency: 'GTQ',
      });
      prisma.payment.findFirst.mockResolvedValue(null);
      prisma.paymentGateway.findUnique.mockResolvedValue(gwActive());
      gateways.platformDefault.mockResolvedValue(gwActive());
      prisma.payment.create.mockResolvedValue({
        id: 'p1',
        providerRef: 'sim_r',
        status: 'pending',
        method: 'gateway',
        amount: dec('129.68'),
        walletAmount: dec(0),
      });
      const res = (await service.initiate('o1', 'u1', {})) as { paymentUrl: string };
      expect(res.paymentUrl).toBe('http://pay');
      expect(provider.createPayment).toHaveBeenCalled();
      expect((provider.scheduleAutoConfirm as jest.Mock)).toHaveBeenCalled();
    });

    it('promotor de PRUEBA: el cobro se ancla a Sandbox aunque el comprador elija otra pasarela', async () => {
      const { prisma, gateways, pricing, costShare, service } = build();
      prisma.event.findUnique.mockResolvedValue({ promoter: { isTestUser: true } });
      gateways.sandboxGateway.mockResolvedValue({ id: 'SANDBOX', status: 'active' });
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        buyerId: 'u1',
        status: 'pending',
        eventId: 'ev1',
        feeGatewayId: 'GWDEF',
        total: '129.68',
        currency: 'GTQ',
        feeScheduleVersion: 1,
      });
      prisma.payment.findFirst.mockResolvedValue(null);
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        id: 'o1',
        total: '129.68',
        feeGatewayId: 'SANDBOX',
        items: [],
        event: { ivaOnNet: true, absorbInstallmentCost: false, promoterId: 'p1' },
      });
      // La pasarela elegida por el comprador ('gReal') se ignora: se resuelve la Sandbox.
      gateways.get.mockResolvedValue({ id: 'SANDBOX', status: 'active', feePct: dec(0.05), transactionFixedFee: dec(0) });
      pricing.paramsForRequote.mockResolvedValue({ platformFeePct: 0.1, gatewayFeePct: 0.05, ivaPct: 0.12 });
      costShare.gatewayAllowed.mockReturnValue(true);
      prisma.payment.create.mockResolvedValue({
        id: 'p1',
        providerRef: 'sim_r',
        status: 'pending',
        method: 'gateway',
        amount: dec('129.68'),
        walletAmount: dec(0),
      });
      await service.initiate('o1', 'u1', { gatewayId: 'gReal' });
      // Se pidió la Sandbox, no la elegida por el comprador.
      expect(gateways.get).toHaveBeenCalledWith('SANDBOX');
    });

    it('promotor de PRUEBA sin Sandbox activa → conserva la elección del comprador', async () => {
      const { prisma, gateways, service } = build();
      prisma.event.findUnique.mockResolvedValue({ promoter: { isTestUser: true } });
      gateways.sandboxGateway.mockResolvedValue(null); // no hay sandbox
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        buyerId: 'u1',
        status: 'pending',
        eventId: 'ev1',
        feeGatewayId: 'gX',
        total: '129.68',
        currency: 'GTQ',
      });
      prisma.payment.findFirst.mockResolvedValue(null);
      gateways.get.mockResolvedValue({ id: 'gX', status: 'inactive' });
      // Sin sandbox, se usa la elegida ('gX'); al estar inactiva → 400 (prueba que NO se ancló).
      await expect(service.initiate('o1', 'u1', { gatewayId: 'gX' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(gateways.get).toHaveBeenCalledWith('gX');
    });

    it('proveedor sin auto-confirm no rompe el flujo', async () => {
      const provider = { name: 'sim', createPayment: jest.fn().mockResolvedValue({ paymentUrl: 'x' }) };
      const { prisma, gateways, service } = build(provider);
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        buyerId: 'u1',
        status: 'pending',
        feeGatewayId: 'GWDEF',
        total: '129.68',
        currency: 'GTQ',
      });
      prisma.payment.findFirst.mockResolvedValue(null);
      prisma.paymentGateway.findUnique.mockResolvedValue(gwActive());
      gateways.platformDefault.mockResolvedValue(gwActive());
      prisma.payment.create.mockResolvedValue({
        id: 'p1',
        providerRef: 'sim_r',
        status: 'pending',
        method: 'gateway',
        amount: dec('129.68'),
        walletAmount: dec(0),
      });
      const res = await service.initiate('o1', 'u1', {});
      expect(res.paymentId).toBe('p1');
    });

    it('pasarela elegida inactiva → 400', async () => {
      const { prisma, gateways, service } = build();
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        buyerId: 'u1',
        status: 'pending',
        feeGatewayId: null,
        total: '129.68',
        currency: 'GTQ',
      });
      prisma.payment.findFirst.mockResolvedValue(null);
      gateways.get.mockResolvedValue({ id: 'gX', status: 'inactive' });
      await expect(service.initiate('o1', 'u1', { gatewayId: 'gX' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('cuotas sin ninguna pasarela activa → 400', async () => {
      const { prisma, gateways, service } = build();
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        buyerId: 'u1',
        status: 'pending',
        feeGatewayId: null,
        total: '129.68',
        currency: 'GTQ',
      });
      prisma.payment.findFirst.mockResolvedValue(null);
      gateways.platformDefault.mockResolvedValue(null); // no hay default activa
      await expect(
        service.initiate('o1', 'u1', { installments: 3 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sin método de pago disponible para cobrar por pasarela → 400', async () => {
      const { prisma, gateways, service } = build();
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        buyerId: 'u1',
        status: 'pending',
        feeGatewayId: null,
        total: '129.68',
        currency: 'GTQ',
      });
      prisma.payment.findFirst.mockResolvedValue(null);
      gateways.platformDefault.mockResolvedValue(null);
      await expect(service.initiate('o1', 'u1', {})).rejects.toBeInstanceOf(BadRequestException);
    });

    it('cae a la default de plataforma y la recotización se bloquea por cost-share → 409', async () => {
      const { prisma, gateways, costShare, service } = build();
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        buyerId: 'u1',
        status: 'pending',
        feeGatewayId: 'GW1', // pasarela de la orden, quedará inactiva
        total: '129.68',
        currency: 'GTQ',
        feeScheduleVersion: 1,
      });
      prisma.payment.findFirst.mockResolvedValue(null);
      // La pasarela de la orden está inactiva → cae a platformDefault (línea 331).
      prisma.paymentGateway.findUnique.mockResolvedValue({ id: 'GW1', status: 'inactive' });
      gateways.platformDefault.mockResolvedValue({
        id: 'GWDEF',
        status: 'active',
        feePct: dec(0.05),
        transactionFixedFee: dec(0),
      });
      // needsRequote (GWDEF != GW1) → requote → política del promotor lo rechaza.
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        id: 'o1',
        items: [{ id: 'i1', net: dec(100) }],
        event: { ivaOnNet: true, absorbInstallmentCost: false, promoterId: 'P' },
      });
      costShare.effectivePct.mockResolvedValue(0);
      costShare.gatewayAllowed.mockReturnValue(false); // no permitida → 409
      await expect(service.initiate('o1', 'u1', {})).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('paymentOptions', () => {
    it('descarta un plazo que el promotor no puede absorber (neto insuficiente)', async () => {
      const { prisma, gateways, costShare, pricing, service } = build();
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        buyerId: 'u1',
        currency: 'GTQ',
        feeScheduleVersion: 1,
        items: [{ net: dec('0.10') }], // neto minúsculo
        event: { ivaOnNet: true, absorbInstallmentCost: true, promoterId: 'P' },
      });
      costShare.effectivePct.mockResolvedValue(0.5);
      costShare.installmentsMinPct.mockResolvedValue(0.3); // cuotas habilitadas
      costShare.gatewayAllowed.mockReturnValue(true);
      gateways.listActive.mockResolvedValue([
        {
          id: 'g',
          name: 'Recurrente',
          provider: 'sim',
          isPlatformDefault: false,
          feePct: dec(0.05),
          transactionFixedFee: dec(2),
          installmentRates: { '18': 0.14 },
        },
      ]);
      pricing.paramsForRequote.mockResolvedValue({
        platformFeePct: 0.1,
        gatewayFeePct: 0,
        ivaPct: 0.12,
        ivaOnNet: true,
        fixedFees: 0,
      });

      const res = await service.paymentOptions('o1', 'u1');
      expect(res.gateways).toHaveLength(1);
      // El plazo de 18 cuotas se descarta (el promotor no puede absorberlo) → solo 1 pago.
      expect(res.gateways[0].installmentOptions).toEqual([
        expect.objectContaining({ installments: 1 }),
      ]);
    });
  });

  describe('paymentOptions · pasarela efectiva del evento (recommended)', () => {
    const setup = (
      over: {
        feeGatewayId?: string | null;
        gatewayId?: string | null;
        frozenGatewayId?: string | null;
      } = {},
    ) => {
      const { prisma, gateways, costShare, pricing, service } = build();
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        buyerId: 'u1',
        currency: 'GTQ',
        feeScheduleVersion: 1,
        feeGatewayId: over.feeGatewayId ?? null,
        items: [{ net: dec(100) }],
        event: {
          ivaOnNet: true,
          absorbInstallmentCost: false,
          promoterId: 'P',
          gatewayId: over.gatewayId ?? null,
          frozenGatewayId: over.frozenGatewayId ?? null,
        },
      });
      costShare.effectivePct.mockResolvedValue(0);
      costShare.installmentsMinPct.mockResolvedValue(0.3);
      costShare.gatewayAllowed.mockReturnValue(true);
      gateways.listActive.mockResolvedValue([
        { id: 'DEF', name: 'Sandbox', provider: 'sim', isPlatformDefault: true, feePct: dec(0.05), transactionFixedFee: dec(0), installmentRates: null },
        { id: 'REC', name: 'Recurrente', provider: 'recurrente', isPlatformDefault: false, feePct: dec(0.045), transactionFixedFee: dec(0), installmentRates: null },
      ]);
      pricing.paramsForRequote.mockResolvedValue({
        platformFeePct: 0.1,
        gatewayFeePct: 0,
        ivaPct: 0.12,
        ivaOnNet: true,
        fixedFees: 0,
      });
      return { pricing, service };
    };

    it('orden congelada (feeGatewayId) → esa es la recomendada', async () => {
      const { pricing, service } = setup({ feeGatewayId: 'REC', gatewayId: 'DEF' });
      // resolveGateway hace `frozen ?? elegida ?? default`: feeGatewayId gana.
      pricing.resolveFeesForEvent.mockResolvedValue({ gatewayId: 'REC' });
      const res = await service.paymentOptions('o1', 'u1');
      expect(pricing.resolveFeesForEvent).toHaveBeenCalledWith(
        expect.objectContaining({ frozenGatewayId: 'REC', gatewayId: 'DEF' }),
      );
      expect(res.eventGatewayId).toBe('REC');
      expect(res.gateways).toContainEqual(expect.objectContaining({ gatewayId: 'REC', recommended: true }));
      expect(res.gateways).toContainEqual(expect.objectContaining({ gatewayId: 'DEF', recommended: false }));
    });

    it('evento con pasarela elegida (sin congelar) → esa es la recomendada', async () => {
      const { pricing, service } = setup({ gatewayId: 'REC' });
      pricing.resolveFeesForEvent.mockResolvedValue({ gatewayId: 'REC' });
      const res = await service.paymentOptions('o1', 'u1');
      expect(pricing.resolveFeesForEvent).toHaveBeenCalledWith(
        expect.objectContaining({ frozenGatewayId: null, gatewayId: 'REC' }),
      );
      expect(res.eventGatewayId).toBe('REC');
      expect(res.gateways).toContainEqual(expect.objectContaining({ gatewayId: 'REC', recommended: true }));
    });

    it('sin pasarela del evento → default de plataforma es la recomendada', async () => {
      const { pricing, service } = setup();
      pricing.resolveFeesForEvent.mockResolvedValue({ gatewayId: 'DEF' });
      const res = await service.paymentOptions('o1', 'u1');
      expect(res.eventGatewayId).toBe('DEF');
      expect(res.gateways).toContainEqual(expect.objectContaining({ gatewayId: 'DEF', recommended: true }));
      expect(res.gateways).toContainEqual(expect.objectContaining({ gatewayId: 'REC', recommended: false }));
    });
  });

  describe('handleWebhook', () => {
    const sign = (id: string, type: string, ref: string) =>
      hmacSha256(SECRET, `${id}.${type}.${ref}`);

    it('carrera de duplicados (P2002 al insertar) → duplicate', async () => {
      const { prisma, service } = build();
      const payload = { id: 'e1', type: 'payment.succeeded', providerRef: 'r1' };
      prisma.webhookEvent.findUnique.mockResolvedValue(null);
      prisma.webhookEvent.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5' }),
      );
      const res = await service.handleWebhook(
        payload,
        sign(payload.id, payload.type, payload.providerRef),
      );
      expect(res).toEqual({ received: true, duplicate: true });
    });

    it('firma inválida → 401', async () => {
      const { service } = build();
      await expect(
        service.handleWebhook({ id: 'e', type: 'payment.succeeded', providerRef: 'r' }, 'mala'),
      ).rejects.toBeInstanceOf(Error);
    });

    it('sin firma → 401', async () => {
      const { service } = build();
      await expect(
        service.handleWebhook({ id: 'e', type: 'payment.succeeded', providerRef: 'r' }, undefined),
      ).rejects.toBeInstanceOf(Error);
    });

    it('evento ya procesado (idempotente) → duplicate', async () => {
      const { prisma, service } = build();
      const payload = { id: 'e0', type: 'payment.succeeded', providerRef: 'r0' };
      prisma.webhookEvent.findUnique.mockResolvedValue({ processedAt: new Date() });
      const res = await service.handleWebhook(
        payload,
        sign(payload.id, payload.type, payload.providerRef),
      );
      expect(res).toEqual({ received: true, duplicate: true });
    });

    // ── Webhook SVIX de Recurrente ──
    it('Recurrente: firma Svix inválida → 401', async () => {
      const { service } = build();
      await expect(
        service.handleRecurrenteWebhook(
          { svixId: 'm1', svixTimestamp: '1700000000', svixSignature: 'v1,mala' },
          '{"event_type":"intent.succeeded"}',
        ),
      ).rejects.toBeInstanceOf(Error);
    });

    it('Recurrente: intent.succeeded válido → mapea y procesa (por metadata.providerRef)', async () => {
      const { prisma, service } = build();
      const body = JSON.stringify({
        event_type: 'intent.succeeded',
        metadata: { orderId: 'o9', providerRef: 'recurrente_r9' },
      });
      // Ya procesado → cortocircuito duplicate (evita mockear todo el fulfillment).
      prisma.webhookEvent.findUnique.mockResolvedValue({ processedAt: new Date() });
      const res = await service.handleRecurrenteWebhook(
        { svixId: 'm9', svixTimestamp: '1700000000', svixSignature: svixSign('m9', '1700000000', body) },
        body,
      );
      expect(res).toEqual({ received: true, duplicate: true });
    });

    it('Recurrente: event_type desconocido (válido) → ignorado', async () => {
      const { service } = build();
      const body = JSON.stringify({ event_type: 'subscription.created' });
      const res = await service.handleRecurrenteWebhook(
        { svixId: 'm2', svixTimestamp: '1700000000', svixSignature: svixSign('m2', '1700000000', body) },
        body,
      );
      expect(res).toEqual({ received: true, ignored: true });
    });

    it('un error no-P2002 al insertar el webhook se propaga', async () => {
      const { prisma, service } = build();
      const payload = { id: 'e9', type: 'payment.succeeded', providerRef: 'r9' };
      prisma.webhookEvent.findUnique.mockResolvedValue(null);
      prisma.webhookEvent.create.mockRejectedValue(new Error('db down'));
      await expect(
        service.handleWebhook(payload, sign(payload.id, payload.type, payload.providerRef)),
      ).rejects.toThrow('db down');
    });

    it('webhook sin pago asociado → recibido pero unknown', async () => {
      const { prisma, service } = build();
      const payload = { id: 'e8', type: 'payment.succeeded', providerRef: 'r8' };
      prisma.webhookEvent.findUnique.mockResolvedValue(null);
      prisma.webhookEvent.create.mockResolvedValue({});
      prisma.payment.findUnique.mockResolvedValue(null); // no hay pago
      prisma.webhookEvent.update.mockResolvedValue({});
      const res = await service.handleWebhook(
        payload,
        sign(payload.id, payload.type, payload.providerRef),
      );
      expect(res).toEqual({ received: true, unknown: true });
    });

    it('tipo de webhook no manejado → recibido sin efecto', async () => {
      const { prisma, service } = build();
      const payload = { id: 'e2', type: 'payment.desconocido', providerRef: 'r2' };
      prisma.webhookEvent.findUnique.mockResolvedValue(null);
      prisma.webhookEvent.create.mockResolvedValue({});
      prisma.payment.findUnique.mockResolvedValue({ id: 'p2', orderId: 'o2' });
      prisma.webhookEvent.update.mockResolvedValue({});
      const res = await service.handleWebhook(
        payload,
        sign(payload.id, payload.type, payload.providerRef),
      );
      expect(res).toEqual({ received: true });
      expect(prisma.webhookEvent.update).toHaveBeenCalled(); // markProcessed
    });
  });

  describe('paymentOptions (cuotas deshabilitadas)', () => {
    it('sin cost-share suficiente solo ofrece 1 pago', async () => {
      const { prisma, gateways, costShare, pricing, service } = build();
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        buyerId: 'u1',
        currency: 'GTQ',
        feeScheduleVersion: 1,
        items: [{ net: dec(100) }],
        event: { ivaOnNet: true, absorbInstallmentCost: false, promoterId: 'P' },
      });
      costShare.effectivePct.mockResolvedValue(0); // < umbral → cuotas OFF
      costShare.installmentsMinPct.mockResolvedValue(0.3);
      costShare.gatewayAllowed.mockReturnValue(true);
      gateways.listActive.mockResolvedValue([
        {
          id: 'g',
          name: 'Sandbox',
          provider: 'sim',
          isPlatformDefault: true,
          feePct: dec(0.05),
          transactionFixedFee: dec(0),
          installmentRates: { '3': 0.08 },
        },
      ]);
      pricing.paramsForRequote.mockResolvedValue({
        platformFeePct: 0.1,
        gatewayFeePct: 0,
        ivaPct: 0.12,
        ivaOnNet: true,
        fixedFees: 0,
      });
      const res = await service.paymentOptions('o1', 'u1');
      expect(res.gateways[0].installmentOptions).toEqual([
        expect.objectContaining({ installments: 1 }),
      ]);
    });
  });

  describe('fulfill', () => {
    const baseOrder = (over: Record<string, unknown> = {}) => ({
      id: 'o1',
      status: 'pending',
      buyerId: 'u1',
      eventId: 'e1',
      net: dec(100),
      platformFee: dec(10),
      fixedFees: dec(0),
      iva: dec('13.20'),
      gatewayFee: dec('6.48'),
      total: dec('129.68'),
      feeGatewayId: 'GW',
      event: { promoterId: 'P' },
      items: [{ total: dec('129.68') }],
      ...over,
    });

    it('cobro por pasarela: asienta la distribución y confirma la orden', async () => {
      const { prisma, ledger, service } = build();
      prisma.payment.findUniqueOrThrow.mockResolvedValue({
        id: 'p1',
        orderId: 'o1',
        method: 'gateway',
        amount: dec('129.68'),
        walletAmount: dec(0),
      });
      prisma.order.findUniqueOrThrow.mockResolvedValue(baseOrder());
      prisma.ledgerTransaction.findFirst.mockResolvedValue(null);
      prisma.paymentGateway.findUnique.mockResolvedValue({ transactionFixedFee: dec(0) });
      await service.fulfill('p1');
      expect(ledger.post).toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('pago 100% wallet: sin pasarela, debita el saldo y notifica', async () => {
      const { prisma, ledger, stream, service } = build();
      prisma.payment.findUniqueOrThrow.mockResolvedValue({
        id: 'p2',
        orderId: 'o1',
        method: 'wallet',
        amount: dec(0),
        walletAmount: dec('129.68'),
      });
      prisma.order.findUniqueOrThrow.mockResolvedValue(baseOrder({ feeGatewayId: null }));
      prisma.ledgerTransaction.findFirst.mockResolvedValue(null);
      await service.fulfill('p2');
      expect(ledger.post).toHaveBeenCalled();
      expect(stream.emitWallet).toHaveBeenCalled(); // pushWallet por walletAmount > 0
    });

    it('orden ya pagada (el CAS no reclama) → no re-asienta (idempotente)', async () => {
      const { prisma, ledger, service } = build();
      prisma.payment.findUniqueOrThrow.mockResolvedValue({ id: 'p3', orderId: 'o1' });
      prisma.order.findUniqueOrThrow.mockResolvedValue(baseOrder({ status: 'paid' }));
      prisma.order.updateMany.mockResolvedValue({ count: 0 }); // el CAS pending→paid no reclama (ya paid)
      await service.fulfill('p3');
      expect(ledger.post).not.toHaveBeenCalled();
    });

    it('reclama pending→paid y asienta con idempotencia EN EL LEDGER (no findFirst externo)', async () => {
      const { prisma, ledger, service } = build();
      prisma.payment.findUniqueOrThrow.mockResolvedValue({
        id: 'p4',
        orderId: 'o1',
        method: 'gateway',
        amount: dec('129.68'),
        walletAmount: dec(0),
      });
      prisma.order.findUniqueOrThrow.mockResolvedValue(baseOrder());
      prisma.paymentGateway.findUnique.mockResolvedValue({ transactionFixedFee: dec(0) });
      prisma.order.updateMany.mockResolvedValue({ count: 1 }); // gana el claim
      await service.fulfill('p4');
      // La idempotencia ya NO es un findFirst externo (TOCTOU) sino la del propio ledger:
      // el asiento se envía SIEMPRE con idempotent:true (dedupe race-safe dentro del post).
      expect(ledger.post).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'order_payment',
          refType: 'order',
          refId: 'o1',
          idempotent: true,
        }),
      );
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('C1 · pago tardío: expira entre la lectura y el CAS → NO asienta (reconciliación)', async () => {
      const { prisma, ledger, service } = build();
      prisma.payment.findUniqueOrThrow.mockResolvedValue({ id: 'p5', orderId: 'o1' });
      // 1ª lectura: pending; el CAS no reclama (sweeper expiró); relectura: expired.
      prisma.order.findUniqueOrThrow
        .mockResolvedValueOnce(baseOrder({ status: 'pending' }))
        .mockResolvedValueOnce({ status: 'expired' });
      prisma.order.updateMany.mockResolvedValue({ count: 0 });
      await service.fulfill('p5');
      // Un pago que llega tras la expiración NO mueve dinero (evita dinero sin boletos).
      expect(ledger.post).not.toHaveBeenCalled();
    });
  });

  describe('requote (recotización directa, pago único)', () => {
    it('recotiza los ítems de la orden con la comisión de la pasarela (default 1 pago)', async () => {
      const { prisma, pricing, costShare, service } = build();
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        id: 'o1',
        items: [{ id: 'i1', net: dec(100) }],
        event: { ivaOnNet: true, absorbInstallmentCost: false, promoterId: 'P' },
      });
      costShare.effectivePct.mockResolvedValue(0.5);
      costShare.gatewayAllowed.mockReturnValue(true);
      pricing.paramsForRequote.mockResolvedValue({
        platformFeePct: 0.1,
        gatewayFeePct: 0.05,
        ivaPct: 0.12,
        ivaOnNet: true,
        fixedFees: 0,
      });
      const gateway = { id: 'g', feePct: dec(0.05), transactionFixedFee: dec(0), installmentRates: null };
      // Llamada directa al método privado con 2 args → ejercita el default installments = 1.
      await (service as unknown as { requote: (o: string, g: unknown) => Promise<void> }).requote(
        'o1',
        gateway,
      );
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.orderItem.update).toHaveBeenCalled();
    });
  });

  describe('fail', () => {
    it('ignora una orden ya pagada (idempotente)', async () => {
      const { prisma, ledger, service } = build();
      prisma.payment.findUniqueOrThrow.mockResolvedValue({ id: 'p1', orderId: 'o1' });
      prisma.order.findUniqueOrThrow.mockResolvedValue({ id: 'o1', status: 'paid', items: [] });
      await service.fail('p1', 'gateway_declined');
      expect(ledger.post).not.toHaveBeenCalled();
    });

    it('pago ya procesado (no pendiente) → return sin efecto', async () => {
      const { prisma, ledger, service } = build();
      prisma.payment.findUniqueOrThrow.mockResolvedValue({
        id: 'p1',
        orderId: 'o1',
        status: 'failed',
        method: 'gateway',
        walletAmount: dec(0),
      });
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        id: 'o1',
        status: 'cancelled',
        eventId: 'e1',
        items: [],
      });
      await service.fail('p1', 'x');
      expect(ledger.post).not.toHaveBeenCalled();
    });

    it('pago pendiente fallido: libera inventario y cancela la orden', async () => {
      const { prisma, stream, service } = build();
      prisma.payment.findUniqueOrThrow.mockResolvedValue({
        id: 'p1',
        orderId: 'o1',
        status: 'pending',
        method: 'gateway',
        walletAmount: dec(0),
      });
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        id: 'o1',
        status: 'pending',
        eventId: 'e1',
        items: [{ seatId: 's1' }],
      });
      await service.fail('p1', 'declined');
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(stream.emitOrder).toHaveBeenCalledWith('o1', { status: 'cancelled' });
    });

    it('pago mixto fallido reintegra la reserva de wallet', async () => {
      const { prisma, ledger, service } = build();
      prisma.payment.findUniqueOrThrow.mockResolvedValue({
        id: 'p1',
        orderId: 'o1',
        status: 'pending',
        method: 'mixed',
        walletAmount: dec('50.00'),
      });
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        id: 'o1',
        status: 'pending',
        eventId: 'e1',
        items: [],
      });
      await service.fail('p1', 'declined');
      expect(ledger.post).toHaveBeenCalled(); // devolución de la reserva
    });
  });
});
