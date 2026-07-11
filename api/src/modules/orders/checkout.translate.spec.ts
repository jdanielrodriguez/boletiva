import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CheckoutService } from './checkout.service';

/**
 * Contrato de errores del commit de compra: `translate()` mapea cada fallo de
 * Postgres/Prisma a la excepción HTTP correcta. Se prueba en aislamiento (sin BD)
 * porque las rutas de concurrencia (lock_timeout / unique_violation / pool
 * saturado) son difíciles de forzar de forma determinista en un e2e, pero su
 * mapeo es lógica de negocio crítica: un 500 aquí sería un bug de contrato.
 */
describe('CheckoutService.translate (contrato de errores)', () => {
  // translate() solo usa this.logger; las dependencias no se tocan.
  const service = new CheckoutService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const translate = (e: unknown): Error =>
    (service as unknown as { translate(e: unknown): Error }).translate(e);

  it('excepciones HTTP de negocio pasan tal cual (sin remapear)', () => {
    const bad = new BadRequestException('x');
    const conflict = new ConflictException('x');
    const notFound = new NotFoundException('x');
    const forbidden = new ForbiddenException('x');
    const unprocessable = new UnprocessableEntityException('x');
    expect(translate(bad)).toBe(bad);
    expect(translate(conflict)).toBe(conflict);
    expect(translate(notFound)).toBe(notFound);
    expect(translate(forbidden)).toBe(forbidden);
    expect(translate(unprocessable)).toBe(unprocessable);
  });

  it('lock_timeout / 55P03 / canceling statement → 409 (en disputa, reintentar)', () => {
    for (const msg of [
      'lock_timeout expired',
      'error 55P03 lock_not_available',
      'canceling statement due to lock timeout',
    ]) {
      const out = translate(new Error(msg));
      expect(out).toBeInstanceOf(ConflictException);
      expect((out as ConflictException).getStatus()).toBe(409);
      expect(String((out as ConflictException).message)).toMatch(/disputa/i);
    }
  });

  it('unique_violation del índice parcial (P2002 / 23505 / nombre del índice) → 409 (ya vendido)', () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'x',
    });
    const byName = new Error('duplicate key value violates order_items_active_seat_uniq');
    const byCode = new Error('ERROR: 23505 duplicate key');
    for (const e of [p2002, byName, byCode]) {
      const out = translate(e);
      expect(out).toBeInstanceOf(ConflictException);
      expect(String((out as ConflictException).message)).toMatch(/ya fue vendido/i);
    }
  });

  it('P2028 / pool saturado → 503 (capacidad, reintentable, NUNCA 500)', () => {
    const p2028 = new Prisma.PrismaClientKnownRequestError('tx', {
      code: 'P2028',
      clientVersion: 'x',
    });
    const byMsg = new Error('Unable to start a transaction in the given time');
    const apiErr = new Error('Transaction API error');
    for (const e of [p2028, byMsg, apiErr]) {
      const out = translate(e);
      expect(out).toBeInstanceOf(ServiceUnavailableException);
      expect((out as ServiceUnavailableException).getStatus()).toBe(503);
    }
  });

  it('error inesperado (Error) se devuelve tal cual para propagar 500 controlado', () => {
    const boom = new Error('algo raro pasó');
    expect(translate(boom)).toBe(boom);
  });

  it('valor no-Error (string) se envuelve en Error (nunca rompe el manejador)', () => {
    const out = translate('cadena cruda de error');
    expect(out).toBeInstanceOf(Error);
    expect(out.message).toBe('cadena cruda de error');
  });
});
