import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../../../infra/integrations/integrations.service';
import { hmacSha256 } from '../../../common/utils/crypto';
import { PagaloPaymentProvider } from './pagalo.provider';

const WEBHOOK_SECRET = 'test-webhook-secret';
const PAGALO = {
  credencial: 'cred-123',
  dominio: 'sandbox.pagalocard.com',
  estado: 'sandbox',
  keyPublic: 'pub-key',
  keySecret: 'sec-key',
  idenEmpresa: 'empresa-9',
  webhookSecret: 'pagalo-wh',
};

function makeConfig(): ConfigService {
  const values: Record<string, unknown> = {
    'payment.webhookSecret': WEBHOOK_SECRET,
    'payment.provider': 'pagalo',
    pagalo: PAGALO,
  };
  return {
    get: (k: string) => values[k],
    getOrThrow: (k: string) => values[k],
  } as unknown as ConfigService;
}

function makeIntegrations(available: boolean): IntegrationsService {
  return {
    available: () => available,
    assertAvailable: () => {
      if (!available) throw new ServiceUnavailableException('Servicio no disponible: la pasarela Pagalo…');
    },
  } as unknown as IntegrationsService;
}

const CARD = {
  number: '4242424242424242',
  expMonth: '12',
  expYear: '2030',
  cvv: '123',
  name: 'JUAN PEREZ',
};
const INPUT = { providerRef: 'pagalo_ref1', orderId: 'ord-1', amount: '129.68', currency: 'GTQ', card: CARD };

describe('PagaloPaymentProvider (value-ready, contrato real)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sin credenciales → createPayment lanza 503 y NO llama a fetch', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const p = new PagaloPaymentProvider(makeConfig(), makeIntegrations(false));
    await expect(p.createPayment(INPUT)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('con credenciales → construye el body real y llama al endpoint correcto', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ estado: 'aprobada', id: 'txn-99' }),
    } as unknown as Response);

    const p = new PagaloPaymentProvider(makeConfig(), makeIntegrations(true));
    const res = await p.createPayment(INPUT);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://sandbox.pagalocard.com/api/v1/integracion/cred-123');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({
      'Content-Type': 'application/x-www-form-urlencoded',
    });

    const form = new URLSearchParams((init as RequestInit).body as string);
    const empresa = JSON.parse(form.get('empresa') as string);
    expect(empresa).toEqual({ key_secret: 'sec-key', key_public: 'pub-key', idenEmpresa: 'empresa-9' });
    const cliente = JSON.parse(form.get('cliente') as string);
    expect(cliente).toMatchObject({ codigo: 'ord-1', country: 'GT', currency: 'GTQ', Total: '129.68' });
    const detalle = JSON.parse(form.get('detalle') as string);
    expect(detalle).toMatchObject({ id_producto: 'ord-1', tipo: 'producto', precio: '129.68', Subtotal: '129.68' });
    // tarjetaPagalo lleva el shape exacto del contrato pagalocard, con la tarjeta del checkout.
    const tarjeta = JSON.parse(form.get('tarjetaPagalo') as string);
    expect(tarjeta).toEqual({
      nameCard: 'JUAN PEREZ',
      accountNumber: '4242424242424242',
      expirationMonth: '12',
      expirationYear: '2030',
      CVVCard: '123',
    });
    // el nombre en la tarjeta identifica al comprador en el objeto cliente
    expect(cliente).toMatchObject({ firstName: 'JUAN PEREZ' });

    expect(res.providerRef).toBe('pagalo_ref1');
  });

  it('sin tarjeta → createPayment lanza 400 y NO llama a fetch (Pagalo requiere la tarjeta)', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const p = new PagaloPaymentProvider(makeConfig(), makeIntegrations(true));
    const noCard = { providerRef: 'pagalo_ref1', orderId: 'ord-1', amount: '129.68', currency: 'GTQ' };
    await expect(p.createPayment(noCard)).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('aprobación sincrónica → scheduleAutoConfirm entrega un payment.succeeded FIRMADO', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ estado: 'aprobada', id: 'txn-99' }),
    } as unknown as Response);

    const p = new PagaloPaymentProvider(makeConfig(), makeIntegrations(true));
    await p.createPayment(INPUT);

    const deliver = jest.fn().mockResolvedValue(undefined);
    p.scheduleAutoConfirm(INPUT.providerRef, deliver);

    expect(deliver).toHaveBeenCalledTimes(1);
    const [payload, signature] = deliver.mock.calls[0];
    expect(payload).toMatchObject({ type: 'payment.succeeded', providerRef: 'pagalo_ref1' });
    expect(typeof payload.id).toBe('string');
    expect(signature).toBe(hmacSha256(WEBHOOK_SECRET, `${payload.id}.payment.succeeded.pagalo_ref1`));
  });

  it('sin aprobación sincrónica → scheduleAutoConfirm es no-op (espera el webhook del gateway)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ estado: 'pendiente' }),
    } as unknown as Response);

    const p = new PagaloPaymentProvider(makeConfig(), makeIntegrations(true));
    await p.createPayment(INPUT);

    const deliver = jest.fn().mockResolvedValue(undefined);
    p.scheduleAutoConfirm(INPUT.providerRef, deliver);
    expect(deliver).not.toHaveBeenCalled();
  });
});
