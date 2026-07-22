import { Role } from '@prisma/client';
import { SupportGateway } from './support.gateway';

/**
 * H-1 (QA): `join-ticket` debe AUTORIZAR. Solo un agente (asesor/admin) o el promotor
 * DUEÑO del ticket pueden unirse a la sala `ticket:<id>`. Un usuario autenticado que
 * conozca un UUID ajeno NO debe entrar (recibía mensajes en vivo antes del fix).
 */
describe('SupportGateway.onJoinTicket (H-1 authz)', () => {
  function makeGateway(ticketOwnerId: string | null) {
    const prisma = {
      supportTicket: {
        findUnique: jest.fn().mockResolvedValue(ticketOwnerId ? { promoterId: ticketOwnerId } : null),
      },
    };
    // Solo se usan jwt/config/redis en connect(); aquí probamos onJoinTicket aislado.
    const gw = new SupportGateway({} as never, {} as never, {} as never, prisma as never);
    return { gw, prisma };
  }

  function fakeClient(userId: string, roles: Role[]) {
    return {
      data: { user: { userId, roles } },
      join: jest.fn(),
      emit: jest.fn(),
    };
  }

  it('un agente (asesor) se une sin consultar propiedad', async () => {
    const { gw, prisma } = makeGateway('owner-1');
    const client = fakeClient('agent-1', [Role.advisor]);
    await gw.onJoinTicket(client as never, { ticketId: 't1' });
    expect(client.join).toHaveBeenCalledWith('ticket:t1');
    expect(prisma.supportTicket.findUnique).not.toHaveBeenCalled();
  });

  it('el promotor DUEÑO se une', async () => {
    const { gw } = makeGateway('promo-1');
    const client = fakeClient('promo-1', [Role.promoter]);
    await gw.onJoinTicket(client as never, { ticketId: 't1' });
    expect(client.join).toHaveBeenCalledWith('ticket:t1');
  });

  it('un promotor AJENO NO se une → join-denied', async () => {
    const { gw } = makeGateway('promo-1');
    const intruso = fakeClient('promo-2', [Role.promoter]);
    await gw.onJoinTicket(intruso as never, { ticketId: 't1' });
    expect(intruso.join).not.toHaveBeenCalled();
    expect(intruso.emit).toHaveBeenCalledWith('join-denied', { ticketId: 't1' });
  });

  it('ticket inexistente → no se une', async () => {
    const { gw } = makeGateway(null);
    const client = fakeClient('promo-1', [Role.promoter]);
    await gw.onJoinTicket(client as never, { ticketId: 'ghost' });
    expect(client.join).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith('join-denied', { ticketId: 'ghost' });
  });
});
