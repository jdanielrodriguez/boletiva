import { BadRequestException, ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function mockHost(): { host: ArgumentsHost; json: jest.Mock; status: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status };
  const req = { originalUrl: '/api/v1/x', method: 'GET', id: 'req-1', headers: {} };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

describe('AllExceptionsFilter', () => {
  it('formatea una HttpException con statusCode, requestId y timestamp', () => {
    const { host, json, status } = mockHost();
    new AllExceptionsFilter(false).catch(new BadRequestException('campo inválido'), host);

    expect(status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0][0];
    expect(body.statusCode).toBe(400);
    expect(body.message).toBe('campo inválido');
    expect(body.requestId).toBe('req-1');
    expect(body.path).toBe('/api/v1/x');
    expect(body.timestamp).toBeDefined();
  });

  it('convierte un Error genérico en 500; en no-prod muestra el mensaje pero NO el stack por defecto (B-03)', () => {
    const { host, json, status } = mockHost();
    new AllExceptionsFilter(false).catch(new Error('kaboom'), host);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.statusCode).toBe(500);
    expect(body.message).toBe('kaboom');
    // B-03: el stack NO se expone salvo que se habilite explícitamente (2º arg).
    expect(body.stack).toBeUndefined();
  });

  it('B-03: el stack SOLO se expone cuando exposeStack=true (independiente de NODE_ENV)', () => {
    const { host, json } = mockHost();
    new AllExceptionsFilter(false, true).catch(new Error('kaboom'), host);
    expect(json.mock.calls[0][0].stack).toBeDefined();
  });

  it('B-03: aunque exposeStack=true en PROD, el stack se expone pero el mensaje interno se oculta', () => {
    const { host, json } = mockHost();
    new AllExceptionsFilter(true, true).catch(new Error('secreto interno'), host);
    const body = json.mock.calls[0][0];
    expect(body.message).toBe('Internal server error'); // mensaje interno oculto (isProd)
    expect(body.stack).toBeDefined(); // stack solo por la variable dedicada
  });

  it('oculta detalle y stack en producción por defecto para errores no controlados', () => {
    const { host, json } = mockHost();
    new AllExceptionsFilter(true).catch(new Error('secreto interno'), host);

    const body = json.mock.calls[0][0];
    expect(body.statusCode).toBe(500);
    expect(body.message).toBe('Internal server error');
    expect(body.stack).toBeUndefined();
  });
});
