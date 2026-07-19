import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

/**
 * Control de acceso de operadores de puerta (Ola 6.5, SafeTix). Endurece la
 * validación offline en DOS capas (defensa en profundidad):
 *  1) TOKEN de puerta corto/fresco: un JWT de vida corta con claim `gateEventId`,
 *     emitido solo a un operador ASIGNADO al evento (o a un admin). Un device de
 *     puerta comprometido solo sirve para ESE evento y por poco tiempo.
 *  2) ASIGNACIÓN persistida operador↔evento (`gate_assignments`): se verifica al
 *     pedir el manifiesto; revocar la asignación corta el acceso al instante,
 *     aunque el token corto siga vigente.
 */
@Injectable()
export class GateAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** Evento gestionable por el usuario (admin o promotor dueño). */
  private async assertManages(eventId: string, user: AuthUser) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { promoterId: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');
    if (!user.roles.includes(Role.admin) && event.promoterId !== user.userId) {
      throw new ForbiddenException('No administras este evento');
    }
  }

  /** Asigna un operador (con rol gate_operator) a un evento. */
  async assign(eventId: string, operatorId: string, user: AuthUser) {
    await this.assertManages(eventId, user);
    const op = await this.prisma.user.findUnique({
      where: { id: operatorId },
      select: { id: true, roles: true },
    });
    if (!op) throw new NotFoundException('Operador no encontrado');
    if (!op.roles.includes(Role.gate_operator)) {
      throw new BadRequestException('El usuario no tiene el rol gate_operator');
    }
    try {
      return await this.prisma.gateAssignment.create({
        data: { eventId, operatorId, createdById: user.userId },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('El operador ya está asignado a este evento');
      }
      throw e;
    }
  }

  /** Revoca la asignación (corta el acceso aunque el token corto siga vigente). */
  async revoke(eventId: string, operatorId: string, user: AuthUser) {
    await this.assertManages(eventId, user);
    const res = await this.prisma.gateAssignment.deleteMany({ where: { eventId, operatorId } });
    return { revoked: res.count };
  }

  /** Operadores asignados a un evento (gestión). */
  async list(eventId: string, user: AuthUser) {
    await this.assertManages(eventId, user);
    return this.prisma.gateAssignment.findMany({
      where: { eventId },
      include: { operator: { select: { id: true, email: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Emite un token de puerta corto/fresco para un evento. Admin siempre; un
   * gate_operator solo si está ASIGNADO. TTL configurable (`safetix.gateTokenTtl`).
   */
  async issueGateToken(eventId: string, user: AuthUser) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');
    const isAdmin = user.roles.includes(Role.admin);
    if (!isAdmin) {
      const assigned = await this.prisma.gateAssignment.findUnique({
        where: { eventId_operatorId: { eventId, operatorId: user.userId } },
      });
      if (!assigned) throw new ForbiddenException('No estás asignado a este evento');
    }
    const ttl = this.config.getOrThrow<number>('safetix.gateTokenTtl');
    const roles = isAdmin ? user.roles : [Role.gate_operator];
    const token = this.jwt.sign(
      { sub: user.userId, email: user.email, roles, gateEventId: eventId },
      { secret: this.config.getOrThrow<string>('jwt.accessSecret'), expiresIn: ttl },
    );
    return { token, expiresIn: ttl, gateEventId: eventId };
  }

  /**
   * Enforcement al pedir el manifiesto: admin pasa; si no, exige (1) que el token
   * sea de PUERTA para ESTE evento (`gateEventId` coincidente) y (2) que la
   * asignación siga viva. Un token de acceso normal (sin `gateEventId`) → 403.
   */
  async assertManifestAccess(eventId: string, user: AuthUser): Promise<void> {
    if (user.roles.includes(Role.admin)) return;
    if (user.gateEventId !== eventId) {
      throw new ForbiddenException('Se requiere un token de puerta emitido para este evento');
    }
    const assigned = await this.prisma.gateAssignment.findUnique({
      where: { eventId_operatorId: { eventId, operatorId: user.userId } },
    });
    if (!assigned) throw new ForbiddenException('Tu asignación a este evento fue revocada');
    await this.assertActiveSession(eventId, user);
  }

  /**
   * "Último gana": si el gate-token es de un VALIDADOR (trae `sid`), debe coincidir con el
   * `activeSessionId` vigente de su invitación. Si se canjeó el enlace en otro dispositivo,
   * el sid rotó → este token queda fuera de las operaciones ONLINE (manifiesto/subida).
   * Tokens sin `sid` (operador de puerta asignado directo, sin invitación) NO se afectan.
   */
  private async assertActiveSession(eventId: string, user: AuthUser): Promise<void> {
    if (!user.sid) return;
    const inv = await this.prisma.validatorInvitation.findFirst({
      where: { eventId, operatorId: user.userId },
      select: { activeSessionId: true },
    });
    if (inv && inv.activeSessionId && inv.activeSessionId !== user.sid) {
      throw new ForbiddenException('Se abrió el validador en otro dispositivo; vuelve a abrir el enlace aquí.');
    }
  }

  /**
   * Enforcement de CHECK-IN (hallazgo 8.1): un operador solo valida/marca boletos de
   * un evento al que está ASIGNADO. Admin pasa. Sin asignación → 403 (así un operador
   * del Evento A no puede marcar `used` boletos del Evento B). Nota: exigir además el
   * token de puerta (`gateEventId`) es un endurecimiento adicional futuro.
   */
  async assertAssignedToEvent(eventId: string, user: AuthUser): Promise<void> {
    if (user.roles.includes(Role.admin)) return;
    const assigned = await this.prisma.gateAssignment.findUnique({
      where: { eventId_operatorId: { eventId, operatorId: user.userId } },
    });
    if (!assigned) {
      throw new ForbiddenException('No estás asignado a este evento para validar boletos');
    }
    await this.assertActiveSession(eventId, user);
  }
}
