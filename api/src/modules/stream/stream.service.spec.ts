import { MessageEvent } from '@nestjs/common';
import { StreamService } from './stream.service';

describe('StreamService (SSE bus, Ola 6.5)', () => {
  it('emite el snapshot primero y luego solo los eventos relevantes a la orden/usuario', () => {
    const s = new StreamService();
    const order = { id: 'o1', buyerId: 'u1', eventId: 'e1' };
    const got: MessageEvent[] = [];
    const sub = s.streamForOrder(order, 'u1', { status: 'pending' }).subscribe((e) => got.push(e));

    // 1) snapshot inicial (estado actual, sin depender de haber estado conectado).
    expect(got[0]).toEqual({ type: 'snapshot', data: { status: 'pending' } });

    // 2) eventos de ESTA orden / evento / usuario → se reciben.
    s.emitOrder('o1', { status: 'paid' });
    s.emitSeat('e1', { sold: ['x'] });
    s.emitWallet('u1', { balance: '5.00' });

    // 3) eventos de OTRA orden / evento / usuario → se ignoran (aislamiento).
    s.emitOrder('otra', { status: 'paid' });
    s.emitSeat('otro-evento', { sold: ['y'] });
    s.emitWallet('u2', { balance: '9.99' });

    sub.unsubscribe();

    expect(got).toEqual([
      { type: 'snapshot', data: { status: 'pending' } },
      { type: 'order', data: { status: 'paid' } },
      { type: 'seat', data: { sold: ['x'] } },
      { type: 'wallet', data: { balance: '5.00' } },
    ]);
  });

  it('dos suscriptores de órdenes distintas no se cruzan', () => {
    const s = new StreamService();
    const a: MessageEvent[] = [];
    const b: MessageEvent[] = [];
    const subA = s.streamForOrder({ id: 'oA', buyerId: 'uA', eventId: 'eA' }, 'uA', {}).subscribe((e) => a.push(e));
    const subB = s.streamForOrder({ id: 'oB', buyerId: 'uB', eventId: 'eB' }, 'uB', {}).subscribe((e) => b.push(e));
    s.emitOrder('oA', { status: 'paid' });
    subA.unsubscribe();
    subB.unsubscribe();
    // A recibió snapshot + su order; B solo su snapshot (no vio la orden de A).
    expect(a.filter((e) => e.type === 'order')).toHaveLength(1);
    expect(b.filter((e) => e.type === 'order')).toHaveLength(0);
  });
});
