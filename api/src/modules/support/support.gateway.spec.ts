import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { SupportGateway } from './support.gateway';

/**
 * Gateway de soporte (unit). Verifica el handshake JWT: agente → sala propia + agents
 * + presencia; promotor → solo su sala; token inválido → unauthorized + disconnect;
 * y que emitir sin server no lanza. El Redis adapter (afterInit) queda apagado.
 */
describe('SupportGateway', () => {
  const SECRET = 'test-access-secret';
  const jwt = new JwtService({ secret: SECRET });
  const config = {
    get: () => false, // support.socketRedis OFF
    getOrThrow: () => SECRET,
  } as unknown as import('@nestjs/config').ConfigService;
  const redis = {
    getClient: () => ({ duplicate: () => ({}) }),
  } as unknown as import('../../infra/redis/redis.service').RedisService;
  const prisma = {
    supportTicket: { findUnique: async () => null },
  } as unknown as import('../../infra/prisma/prisma.service').PrismaService;

  function makeGateway(): SupportGateway {
    const g = new SupportGateway(jwt, config, redis, prisma);
    // Server falso con adapter.rooms para handleDisconnect.
    (g as unknown as { server: unknown }).server = {
      sockets: { adapter: { rooms: new Map<string, Set<string>>() } },
      to: () => ({ emit: () => undefined }),
    };
    return g;
  }

  function fakeClient(token?: string) {
    const joined: string[] = [];
    let disconnected = false;
    const emitted: string[] = [];
    return {
      client: {
        handshake: { auth: { token }, query: {} },
        data: {} as Record<string, unknown>,
        join: (room: string) => joined.push(room),
        leave: () => undefined,
        emit: (ev: string) => emitted.push(ev),
        disconnect: () => {
          disconnected = true;
        },
      },
      joined,
      emitted,
      isDisconnected: () => disconnected,
    };
  }

  it('agente (admin) → se une a su sala + agents y queda en presencia', () => {
    const g = makeGateway();
    const token = jwt.sign({ sub: 'admin-1', roles: [Role.admin] });
    const f = fakeClient(token);
    g.handleConnection(f.client as never);
    expect(f.joined).toContain('user:admin-1');
    expect(f.joined).toContain('agents');
    expect(g.agentsOnline()).toBe(true);
  });

  it('promotor → solo su sala, NO agents', () => {
    const g = makeGateway();
    const token = jwt.sign({ sub: 'prom-1', roles: [Role.promoter] });
    const f = fakeClient(token);
    g.handleConnection(f.client as never);
    expect(f.joined).toContain('user:prom-1');
    expect(f.joined).not.toContain('agents');
    expect(g.agentsOnline()).toBe(false);
  });

  it('token inválido → emite unauthorized y desconecta', () => {
    const g = makeGateway();
    const f = fakeClient('basura');
    g.handleConnection(f.client as never);
    expect(f.emitted).toContain('unauthorized');
    expect(f.isDisconnected()).toBe(true);
  });

  it('emitMessage sin server no lanza', () => {
    const g = new SupportGateway(jwt, config, redis, prisma);
    expect(() => g.emitMessage('t1', { body: 'x' })).not.toThrow();
  });
});
