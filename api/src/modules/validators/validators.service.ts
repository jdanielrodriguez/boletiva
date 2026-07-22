import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import { Role, TicketStatus, ValidatorStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { MailService } from '../../infra/mail/mail.service';
import { StreamService } from '../stream/stream.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { randomToken, sha256 } from '../../common/utils/crypto';

/** Fallback de validez del magic-link si el evento no tiene fecha de fin (raro). */
const TTL_DAYS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** TTL del ticket de un solo uso del SSE del dashboard (corto: solo para abrir la conexión). */
const STREAM_TICKET_TTL_S = 15;
/** Gracia tras el fin del evento durante la que el enlace/gate-token siguen válidos. */
const POST_EVENT_GRACE_MS = 6 * 60 * 60 * 1000; // 6 h
/** Límites del TTL del gate-token (segundos): mínimo 30 min, tope 18 h (cubre el evento). */
const GATE_TTL_MIN_S = 30 * 60;
const GATE_TTL_MAX_S = 18 * 60 * 60;

/**
 * Vencimiento del acceso de validación atado al EVENTO (disponible durante el evento
 * activo): fin del evento + gracia. Si no hay `endsAt`, cae al fallback de 30 días.
 */
function accessExpiry(endsAt: Date | null): Date {
  if (!endsAt) return new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);
  return new Date(endsAt.getTime() + POST_EVENT_GRACE_MS);
}

/**
 * Validadores de boletos (autorizadores de acceso). El promotor invita por email a
 * personas que validan boletos en la puerta:
 *  - Se crea un User LIGERO con rol `gate_operator` (acceso solo por magic-link, sin
 *    contraseña) + un `gate_assignment` → reusa TODA la infra SafeTix (manifiesto,
 *    verify, checkins) y su enforcement (token de puerta + asignación viva).
 *  - Se guarda una `validator_invitation` con un código de un solo uso y un token de
 *    magic-link (ambos hasheados). El link abre el validador directo (`claim` → token
 *    de puerta corto). Vale solo mientras `status=active` y la asignación siga viva.
 *  - Deshabilitar (uno o todos) revoca la asignación → corta el manifiesto y el link.
 */
@Injectable()
export class ValidatorsService {
  private readonly logger = new Logger(ValidatorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly jwt: JwtService,
    private readonly stream: StreamService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Emite un TICKET de un solo uso (Redis, 15 s) acotado a este evento, para abrir el SSE
   * del dashboard sin exponer el access token (900 s) en la URL/logs de Cloud Run/LB
   * (CWE-317). Requiere sesión (Bearer en header) y gestionar el evento (admin/promotor dueño).
   */
  async issueStreamTicket(eventId: string, user: AuthUser) {
    await this.assertManages(eventId, user);
    const ticket = randomBytes(24).toString('base64url');
    await this.redis
      .getClient()
      .set(`sse:vticket:${ticket}`, eventId, 'EX', STREAM_TICKET_TTL_S);
    return { ticket, expiresIn: STREAM_TICKET_TTL_S };
  }

  /**
   * Stream SSE del dashboard de check-ins. Auth por TICKET de un solo uso (`?ticket=`): se
   * consume con GETDEL y debe corresponder a ESTE evento. El ownership ya se validó al emitir
   * el ticket (Bearer + rol), así que aquí no viaja ningún token de sesión por la URL.
   */
  async checkinStreamByTicket(eventId: string, ticket?: string) {
    if (!ticket) throw new UnauthorizedException('Se requiere un ticket válido');
    const raw = await this.redis
      .getClient()
      .getdel(`sse:vticket:${ticket}`)
      .catch(() => null);
    if (raw !== eventId) throw new UnauthorizedException('Ticket inválido o expirado');
    return this.stream.streamCheckins(eventId);
  }

  private origin(): string {
    return (this.config.get<string[]>('cors.origins') ?? [])[0] ?? '';
  }

  /** Evento gestionable por el usuario (admin o promotor dueño). */
  private async assertManages(eventId: string, user: AuthUser) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { promoterId: true, name: true, status: true, endsAt: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');
    if (!user.roles.includes(Role.admin) && event.promoterId !== user.userId) {
      throw new ForbiddenException('No administras este evento');
    }
    return event;
  }

  /**
   * Evento CONCLUIDO: terminó por fecha (`endsAt` pasado) o está finalizado/cancelado. Se
   * usa para BLOQUEAR el alta/rotación de accesos de validadores en eventos pasados (ya no
   * tiene sentido dar/rotar acceso de puerta). La lectura (lista, stats) sigue disponible.
   */
  private assertEventActiveForAccess(event: { status: string; endsAt: Date | null }) {
    const ended = !!event.endsAt && event.endsAt.getTime() < Date.now();
    if (ended || event.status === 'finished' || event.status === 'cancelled') {
      throw new BadRequestException('El evento ya concluyó: no se pueden emitir accesos de validación.');
    }
  }

  /** Crea/actualiza un validador para el evento e (re)envía su código + magic-link. */
  async invite(eventId: string, rawEmail: string, user: AuthUser) {
    const event = await this.assertManages(eventId, user);
    this.assertEventActiveForAccess(event);
    const email = (rawEmail ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new BadRequestException('Correo inválido');

    // 1) User LIGERO con rol gate_operator (o añade el rol si ya existe la cuenta).
    const operator = await this.ensureOperator(email);

    // 2) Asignación operador↔evento (idempotente) → habilita manifiesto/checkins.
    await this.prisma.gateAssignment.upsert({
      where: { eventId_operatorId: { eventId, operatorId: operator.id } },
      create: { eventId, operatorId: operator.id, createdById: user.userId },
      update: {},
    });

    // 3) Invitación con token de magic-link (hasheado). El acceso es SOLO por el enlace;
    //    no se usa un código aparte. `codeHash` es vestigial (columna NOT NULL) → se rellena
    //    con un valor desechable que nunca se expone ni se usa para validar.
    const token = randomToken(24);
    const expiresAt = accessExpiry(event.endsAt);
    const inv = await this.prisma.validatorInvitation.upsert({
      where: { eventId_email: { eventId, email } },
      create: {
        eventId,
        email,
        operatorId: operator.id,
        codeHash: sha256(randomToken(16)),
        tokenHash: sha256(token),
        invitedById: user.userId,
        expiresAt,
      },
      update: {
        codeHash: sha256(randomToken(16)),
        tokenHash: sha256(token),
        status: ValidatorStatus.active,
        expiresAt,
        operatorId: operator.id,
      },
    });

    const url = `${this.origin()}/validar/${token}`;
    await this.sendInviteEmail(email, event.name, url);
    // url se devuelve UNA sola vez (no se puede re-derivar del hash).
    return { id: inv.id, email, status: inv.status, url, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Ancla de la invitación (FK `operatorId`). El validador NO necesita el rol
   * `gate_operator` en su cuenta: el `claim` (magic-link) firma un gate-token que ya
   * lleva `roles:[gate_operator]` + `gateEventId`, y el manifiesto/checkins se autorizan
   * con ESE token + la asignación viva. Por eso:
   *  - Si el email YA es de un usuario (p.ej. un cliente), NO se le toca la cuenta ni los
   *    roles → un mismo correo puede ser cliente Y validador sin interferencia. (B5)
   *  - Si es un email nuevo, se crea un usuario LIGERO solo como ancla de la invitación.
   */
  private async ensureOperator(email: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return { id: existing.id, roles: existing.roles };
    return this.prisma.user.create({
      data: {
        email,
        firstName: 'Validador',
        roles: [Role.gate_operator],
        emailVerifiedAt: new Date(), // invitado → correo de confianza
      },
      select: { id: true, roles: true },
    });
  }

  /** Lista los validadores del evento con su estado (para el panel del promotor). */
  async list(eventId: string, user: AuthUser) {
    await this.assertManages(eventId, user);
    const invs = await this.prisma.validatorInvitation.findMany({
      where: { eventId },
      include: { operator: { select: { id: true, email: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return invs.map((i) => ({
      id: i.id,
      email: i.email,
      operatorId: i.operatorId,
      status: i.status,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    }));
  }

  /**
   * Dashboard de check-ins del evento (admin/promotor dueño): totales por estado,
   * avance por localidad, atribución por validador (quién escaneó cuánto), conflictos
   * (dobles check-in) y los últimos escaneos. Fuente: `tickets` (estado/uso) +
   * `ticket_custody_events` type=checked_in (actor) + `checkin_conflicts`.
   */
  async checkinStats(eventId: string, user: AuthUser) {
    await this.assertManages(eventId, user);

    // Conteos por estado del boleto (indexado por eventId+status).
    const byStatus = await this.prisma.ticket.groupBy({
      by: ['status'],
      where: { eventId },
      _count: { _all: true },
    });
    const countOf = (s: TicketStatus) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
    const checkedIn = countOf(TicketStatus.used);
    const pending = countOf(TicketStatus.valid);
    const transferred = countOf(TicketStatus.transferred);
    const revoked = countOf(TicketStatus.revoked);
    // "vigentes" = boletos que pueden entrar (excluye revocados). Los transferidos
    // siguen vigentes (re-emitidos a su nuevo dueño), así que cuentan en el total.
    const total = checkedIn + pending + transferred;

    const conflicts = await this.prisma.checkinConflict.count({ where: { eventId } });

    // Atribución por validador: custody checked_in agrupado por actor.
    const byActor = await this.prisma.ticketCustodyEvent.groupBy({
      by: ['actorId'],
      where: { type: 'checked_in', ticket: { eventId } },
      _count: { _all: true },
    });
    const actorIds = byActor.map((a) => a.actorId).filter((x): x is string => !!x);
    const operators = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, email: true, firstName: true, lastName: true },
        })
      : [];
    const opById = new Map(operators.map((o) => [o.id, o]));
    const byValidator = byActor
      .map((a) => {
        const op = a.actorId ? opById.get(a.actorId) : undefined;
        return {
          operatorId: a.actorId,
          email: op?.email ?? null,
          name: op ? `${op.firstName ?? ''} ${op.lastName ?? ''}`.trim() || null : null,
          count: a._count._all,
        };
      })
      .sort((x, y) => y.count - x.count);

    // Avance por localidad: total y check-ins por localityId.
    const locGroups = await this.prisma.ticket.groupBy({
      by: ['localityId', 'status'],
      where: { eventId },
      _count: { _all: true },
    });
    const locAgg = new Map<string, { total: number; checkedIn: number }>();
    for (const g of locGroups) {
      const cur = locAgg.get(g.localityId) ?? { total: 0, checkedIn: 0 };
      if (g.status !== TicketStatus.revoked) cur.total += g._count._all;
      if (g.status === TicketStatus.used) cur.checkedIn += g._count._all;
      locAgg.set(g.localityId, cur);
    }
    const locNames = locAgg.size
      ? await this.prisma.locality.findMany({
          where: { id: { in: [...locAgg.keys()] } },
          select: { id: true, name: true },
        })
      : [];
    const locNameById = new Map(locNames.map((l) => [l.id, l.name]));
    const byLocality = [...locAgg.entries()]
      .map(([localityId, v]) => ({ localityId, name: locNameById.get(localityId) ?? '—', ...v }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Últimos escaneos (timeline del dashboard).
    const recentRows = await this.prisma.ticketCustodyEvent.findMany({
      where: { type: 'checked_in', ticket: { eventId } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        createdAt: true,
        actorId: true,
        ticket: { select: { serial: true, locality: { select: { name: true } } } },
      },
    });
    const recent = recentRows.map((r) => ({
      serial: r.ticket.serial,
      locality: r.ticket.locality?.name ?? null,
      validator: r.actorId ? opById.get(r.actorId)?.email ?? null : null,
      at: r.createdAt.toISOString(),
    }));

    return {
      eventId,
      total,
      checkedIn,
      pending,
      transferred,
      revoked,
      conflicts,
      percent: total > 0 ? Math.round((checkedIn / total) * 1000) / 10 : 0,
      byLocality,
      byValidator,
      recent,
      updatedAt: new Date().toISOString(),
    };
  }

  /** Deshabilita un validador: status=disabled + revoca la asignación (corta el link). */
  async disable(eventId: string, id: string, user: AuthUser) {
    await this.assertManages(eventId, user);
    const inv = await this.prisma.validatorInvitation.findFirst({ where: { id, eventId } });
    if (!inv) throw new NotFoundException('Validador no encontrado');
    await this.prisma.$transaction([
      this.prisma.validatorInvitation.update({
        where: { id },
        data: { status: ValidatorStatus.disabled },
      }),
      this.prisma.gateAssignment.deleteMany({ where: { eventId, operatorId: inv.operatorId } }),
    ]);
    return { disabled: true };
  }

  /**
   * ELIMINA un validador del evento (borra la invitación + su asignación). A diferencia de
   * deshabilitar (que conserva el registro para poder rehabilitar), esto lo quita de la
   * lista. Solo se permite sobre validadores DESHABILITADOS (para eliminar uno activo,
   * primero deshabilítalo). El User operador se conserva (puede validar otros eventos).
   */
  async remove(eventId: string, id: string, user: AuthUser) {
    await this.assertManages(eventId, user);
    const inv = await this.prisma.validatorInvitation.findFirst({ where: { id, eventId } });
    if (!inv) throw new NotFoundException('Validador no encontrado');
    if (inv.status !== ValidatorStatus.disabled) {
      throw new BadRequestException('Deshabilita el validador antes de eliminarlo');
    }
    await this.prisma.$transaction([
      this.prisma.gateAssignment.deleteMany({ where: { eventId, operatorId: inv.operatorId } }),
      this.prisma.validatorInvitation.delete({ where: { id } }),
    ]);
    return { removed: true };
  }

  /** Deshabilita TODOS los validadores activos del evento de una vez. */
  async disableAll(eventId: string, user: AuthUser) {
    await this.assertManages(eventId, user);
    const active = await this.prisma.validatorInvitation.findMany({
      where: { eventId, status: ValidatorStatus.active },
      select: { operatorId: true },
    });
    const opIds = active.map((a) => a.operatorId);
    await this.prisma.$transaction([
      this.prisma.validatorInvitation.updateMany({
        where: { eventId, status: ValidatorStatus.active },
        data: { status: ValidatorStatus.disabled },
      }),
      this.prisma.gateAssignment.deleteMany({ where: { eventId, operatorId: { in: opIds } } }),
    ]);
    return { disabled: opIds.length };
  }

  /**
   * (Re)habilita un validador y REENVÍA su enlace: re-crea la asignación (restaura el
   * acceso), rota el token (invalida el enlace anterior) y reenvía el correo. Sirve tanto
   * para "rehabilitar" (estaba deshabilitado) como para "reenviar enlace" (estaba activo
   * pero se venció/perdió). Idempotente respecto al estado final (queda activo).
   */
  async enable(eventId: string, id: string, user: AuthUser) {
    const event = await this.assertManages(eventId, user);
    this.assertEventActiveForAccess(event);
    const inv = await this.prisma.validatorInvitation.findFirst({ where: { id, eventId } });
    if (!inv) throw new NotFoundException('Validador no encontrado');
    const token = randomToken(24);
    const expiresAt = accessExpiry(event.endsAt);
    await this.prisma.$transaction([
      this.prisma.gateAssignment.upsert({
        where: { eventId_operatorId: { eventId, operatorId: inv.operatorId } },
        create: { eventId, operatorId: inv.operatorId, createdById: user.userId },
        update: {},
      }),
      this.prisma.validatorInvitation.update({
        where: { id },
        data: {
          status: ValidatorStatus.active,
          codeHash: sha256(randomToken(16)),
          tokenHash: sha256(token),
          expiresAt,
        },
      }),
    ]);
    const url = `${this.origin()}/validar/${token}`;
    await this.sendInviteEmail(inv.email, event.name, url);
    return { id: inv.id, email: inv.email, status: ValidatorStatus.active, url, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Canje del magic-link (PÚBLICO): valida el token, exige que el validador siga
   * habilitado (status=active + asignación viva) y emite un TOKEN DE PUERTA corto
   * (mismo formato que gate-access) con el que la PWA pide el manifiesto y valida.
   */
  async claim(token: string) {
    const inv = await this.findUsable(token);
    const assigned = await this.prisma.gateAssignment.findUnique({
      where: { eventId_operatorId: { eventId: inv.eventId, operatorId: inv.operatorId } },
    });
    if (!assigned) throw new ForbiddenException('Tu acceso a este evento fue revocado');
    const event = await this.prisma.event.findUniqueOrThrow({
      where: { id: inv.eventId },
      select: { id: true, name: true, slug: true, startsAt: true, endsAt: true },
    });
    // "Último gana": cada canje rota el sid de la invitación → el gate-token anterior deja
    // de pasar el chequeo online (manifiesto/subida) en otro dispositivo.
    const sid = randomToken(12);
    await this.prisma.validatorInvitation.update({
      where: { id: inv.id },
      data: { activeSessionId: sid },
    });
    // TTL atado al evento (disponible durante el evento activo): hasta endsAt + gracia,
    // acotado a [30 min, 18 h]. Así la subida de check-ins funciona toda la jornada.
    const untilEnd = Math.floor((accessExpiry(event.endsAt).getTime() - Date.now()) / 1000);
    const ttl = Math.max(GATE_TTL_MIN_S, Math.min(GATE_TTL_MAX_S, untilEnd));
    const gateToken = this.jwt.sign(
      { sub: inv.operatorId, email: inv.email, roles: [Role.gate_operator], gateEventId: inv.eventId, sid },
      { secret: this.config.getOrThrow<string>('jwt.accessSecret'), expiresIn: ttl },
    );
    return {
      gateToken,
      expiresIn: ttl,
      gateEventId: inv.eventId,
      event: {
        id: event.id,
        name: event.name,
        slug: event.slug,
        startsAt: event.startsAt.toISOString(),
      },
    };
  }

  /** Vista pública del magic-link: nombre del evento + email (pantalla de bienvenida). */
  async peek(token: string) {
    const inv = await this.findUsable(token);
    const event = await this.prisma.event.findUniqueOrThrow({
      where: { id: inv.eventId },
      select: { name: true },
    });
    return { email: inv.email, eventName: event.name, valid: true };
  }

  /** Invitación usable: existe, activa y no vencida (marca vencidas al vuelo). */
  private async findUsable(token: string) {
    if (!token) throw new NotFoundException('Enlace inválido');
    const inv = await this.prisma.validatorInvitation.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (!inv) throw new NotFoundException('Enlace inválido');
    if (inv.status === ValidatorStatus.disabled) {
      throw new ForbiddenException('Tu acceso fue deshabilitado');
    }
    if (inv.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('El enlace venció; pide al organizador que te reenvíe el acceso');
    }
    return inv;
  }

  private async sendInviteEmail(email: string, eventName: string, url: string): Promise<void> {
    try {
      await this.mail.enqueueTemplated(email, `Valida boletos de "${eventName}" — Boletiva`, {
        title: 'Acceso de validación',
        preheader: `Te habilitaron para validar boletos de ${eventName}.`,
        bodyHtml: `<p style="margin:0 0 12px 0;">Te habilitaron como <strong>validador</strong> de boletos de <strong>${escapeHtml(eventName)}</strong> en Boletiva. Abre el enlace para entrar directo al validador (usa la cámara para escanear los boletos).</p>
          <p class="pe-muted" style="margin:14px 0 0 0;font-size:14px;color:#6b6b76;">El acceso vale mientras el organizador te mantenga habilitado. Si no esperabas esto, ignora este correo.</p>`,
        cta: { url, label: 'Abrir el validador' },
      }, { type: 'validator_invite' });
    } catch (err) {
      this.logger.warn(`No se pudo enviar el acceso de validación a ${email}: ${(err as Error).message}`);
    }
  }
}

/** Escapa HTML básico para el correo (evita romper el markup con el nombre del evento). */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
