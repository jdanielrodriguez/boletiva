import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { ChatGateway } from './chat.gateway';

/**
 * B3 · Gateway del chat. Cubre el handshake (token válido → une salas + presencia de
 * agente; inválido → desconecta), la presencia (agentsOnline) y las emisiones seguras
 * cuando aún no hay servidor socket (test).
 */
describe('ChatGateway', () => {
  let gateway: ChatGateway;
  const jwt = { verify: jest.fn() } as unknown as JwtService;
  const config = { getOrThrow: () => 'secret' } as never;

  const makeClient = () => {
    const joined: string[] = [];
    return {
      joined,
      data: {} as Record<string, unknown>,
      handshake: { auth: {} as Record<string, unknown>, query: {} as Record<string, unknown> },
      join: (room: string) => joined.push(room),
      emit: jest.fn(),
      disconnect: jest.fn(),
    };
  };

  beforeEach(() => {
    gateway = new ChatGateway(jwt, config);
    // server con adapter mínimo para handleDisconnect.
    (gateway as unknown as { server: unknown }).server = {
      sockets: { adapter: { rooms: new Map() } },
      to: () => ({ emit: jest.fn() }),
    };
    jest.clearAllMocks();
  });

  it('token de AGENTE (admin) → une user + agents y cuenta en presencia', () => {
    (jwt.verify as jest.Mock).mockReturnValue({ sub: 'u1', roles: [Role.admin] });
    const client = makeClient();
    client.handshake.auth.token = 'tok';
    gateway.handleConnection(client as never);
    expect(client.joined).toContain('user:u1');
    expect(client.joined).toContain('agents');
    expect(gateway.agentsOnline()).toBe(true);
  });

  it('token de PROMOTOR → une solo su sala, NO cuenta como agente', () => {
    (jwt.verify as jest.Mock).mockReturnValue({ sub: 'p1', roles: [Role.promoter] });
    const client = makeClient();
    client.handshake.auth.token = 'tok';
    gateway.handleConnection(client as never);
    expect(client.joined).toContain('user:p1');
    expect(client.joined).not.toContain('agents');
    expect(gateway.agentsOnline()).toBe(false);
  });

  it('token inválido/ausente → emite unauthorized y desconecta', () => {
    (jwt.verify as jest.Mock).mockImplementation(() => {
      throw new Error('bad');
    });
    const client = makeClient();
    client.handshake.auth.token = 'malo';
    gateway.handleConnection(client as never);
    expect(client.emit).toHaveBeenCalledWith('unauthorized');
    expect(client.disconnect).toHaveBeenCalled();
    expect(gateway.agentsOnline()).toBe(false);
  });

  it('emitMessage no lanza aunque no haya servidor', () => {
    (gateway as unknown as { server: undefined }).server = undefined;
    expect(() => gateway.emitMessage('t1', { body: 'x' })).not.toThrow();
  });
});
