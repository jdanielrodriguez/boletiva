import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChallengePurpose, Event, Role } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { randomToken, sha256 } from '../../common/utils/crypto';
import { ChallengesService } from '../auth/challenges.service';

/**
 * Desbloqueo de edición de evento por ADMIN (v3.5). Un admin que quiere editar un
 * evento AJENO debe autorizarse con un código OTP enviado a su correo; al
 * verificarlo recibe un token de vida corta (5 min) SCOPED a (adminId, eventId),
 * guardado en Redis (hasheado). Las mutaciones del evento por un admin no-dueño
 * exigen ese token (header `x-edit-unlock`). El promotor DUEÑO edita libremente.
 */
@Injectable()
export class EditUnlockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly challenges: ChallengesService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  private key(adminId: string, eventId: string): string {
    return `edit-unlock:${adminId}:${eventId}`;
  }

  private ttl(): number {
    return this.config.get<number>('editUnlock.ttl') ?? 300;
  }

  /** Envía el código OTP al correo del admin para desbloquear la edición del evento. */
  async request(admin: AuthUser, eventId: string): Promise<{ sent: true }> {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Evento no encontrado');
    await this.challenges.issue(admin.userId, admin.email, ChallengePurpose.event_edit_unlock);
    return { sent: true };
  }

  /** Verifica el OTP y emite un token de desbloqueo (Redis, TTL corto, scoped). */
  async verify(
    admin: AuthUser,
    eventId: string,
    code: string,
  ): Promise<{ token: string; expiresAt: string }> {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Evento no encontrado');
    // Consume el OTP (400 si inválido/expirado/demasiados intentos).
    await this.challenges.consumeByCode(
      admin.userId,
      ChallengePurpose.event_edit_unlock,
      code,
    );
    const token = randomToken(24);
    const ttl = this.ttl();
    await this.redis
      .getClient()
      .set(this.key(admin.userId, eventId), sha256(token), 'EX', ttl);
    return { token, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
  }

  /** ¿El admin tiene un token de desbloqueo válido para este evento? */
  private async isUnlocked(adminId: string, eventId: string, token?: string): Promise<boolean> {
    if (!token) return false;
    const stored = await this.redis.getClient().get(this.key(adminId, eventId));
    return !!stored && stored === sha256(token);
  }

  /**
   * Exige desbloqueo cuando el actor es ADMIN y NO es el promotor dueño del evento.
   * El promotor dueño (o un admin que además es el dueño) edita sin restricción.
   * Sin token válido → 403 con mensaje claro.
   */
  async assertCanMutate(
    user: AuthUser,
    event: Pick<Event, 'id' | 'promoterId'>,
    token?: string,
  ): Promise<void> {
    const isAdmin = user.roles.includes(Role.admin);
    const isOwner = event.promoterId === user.userId;
    if (!isAdmin || isOwner) return; // dueño (promotor o admin-dueño) → libre
    if (!(await this.isUnlocked(user.userId, event.id, token))) {
      throw new ForbiddenException(
        'Edición bloqueada: solicita un código de desbloqueo (admin) y verifícalo para editar este evento',
      );
    }
  }
}
