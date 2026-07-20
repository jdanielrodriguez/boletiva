import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  Role,
  SupportCategory,
  SupportContextType,
  SupportPriority,
  SupportStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService } from '../../infra/queue/queue.service';
import { QUEUES } from '../../infra/queue/queue.constants';
import { MailService } from '../../infra/mail/mail.service';
import { StorageService } from '../../infra/storage/storage.service';
import { RedisService } from '../../infra/redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PremiumService } from '../promoters/premium.service';
import { SupportGateway } from './support.gateway';
import { canTransition, isFinal } from './support.states';
import { initialDueDates, mergeSlaTargets, shiftDue, slaRunning, SlaTargets } from './support-sla';
import { KeysetQuery, keysetResult, keysetTake } from '../../common/utils/pagination';

/** Setting (json) con los objetivos SLA que edita el admin; ausente → defaults. */
const SLA_SETTING_KEY = 'support.sla';

/** Filtros de la cola del agente. */
export interface QueueFilters {
  status?: SupportStatus;
  priority?: SupportPriority;
  category?: SupportCategory;
  assigneeId?: string;
  unassigned?: boolean;
  mine?: boolean;
}

/** Ventana para que un promotor REABRA (respondiendo) un ticket ya resuelto. */
const REOPEN_WINDOW_MS = 3 * 24 * 3_600_000; // 3 días

/** Adjuntos (T4): tipos permitidos y tamaño máximo (defensa server-side). */
const ATTACH_ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']);
const ATTACH_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

interface AttachmentInput {
  key: string;
  filename: string;
  mime: string;
  size: number;
}

interface CreateTicketInput {
  subject: string;
  message: string;
  category?: SupportCategory;
  priority?: SupportPriority;
  contextType?: SupportContextType;
  contextId?: string;
}

type SlaJob = { ticketId: string; kind: 'first_response' | 'resolution' };

/**
 * Tickets de soporte (T1; evoluciona el chat B3). El chat vive DENTRO del ticket.
 * Máquina de estados formal + SLA con reloj que pausa en espera/suspensión, ruteo
 * con fallback por correo y auditoría hash-chain de cada transición. Entrega en vivo
 * por socket.io (SupportGateway). Gating: `chat.enabled` global + beneficios premium.
 */
@Injectable()
export class SupportService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SupportService.name);
  private autoCloseTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly mail: MailService,
    private readonly premium: PremiumService,
    private readonly gateway: SupportGateway,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.queue.registerHandler(QUEUES.SUPPORT, (name, data) => this.handleJob(name, data));
    // Sweeper de auto-cierre (apagado por defecto y en test). Una sola instancia por
    // día vía lock distribuido de Redis (igual que retención).
    if (this.config.get<boolean>('support.autoCloseEnabled')) {
      const days = this.config.get<number>('support.autoCloseDays') ?? 7;
      this.autoCloseTimer = setInterval(() => {
        void this.redis.tryLock('support-autoclose', 10 * 60 * 1000).then((got) => {
          if (!got) return;
          return this.autoCloseResolved(days).catch((e) => this.logger.error(`Auto-cierre falló: ${(e as Error).message}`));
        });
      }, 24 * 3_600_000);
      this.logger.log(`Auto-cierre de soporte activo (cada 24h, ${days} días)`);
    }
  }

  onModuleDestroy(): void {
    if (this.autoCloseTimer) clearInterval(this.autoCloseTimer);
  }

  private async handleJob(name: string, data: unknown): Promise<void> {
    if (name === 'sla-check') await this.checkSlaBreach(data as SlaJob);
  }

  // ---------------------------------------------------------------------------
  // Gating / roles
  // ---------------------------------------------------------------------------

  private async supportEnabled(): Promise<boolean> {
    // La llave del setting conserva el nombre histórico `chat.enabled` (contrato con
    // el frontend/public-config); el módulo ya es "support".
    const s = await this.prisma.setting.findUnique({ where: { key: 'chat.enabled' } });
    return s?.value === true;
  }

  private isAgent(user: AuthUser): boolean {
    return user.roles.includes(Role.admin) || user.roles.includes(Role.advisor);
  }

  private senderRoleOf(user: AuthUser): Role {
    if (user.roles.includes(Role.admin)) return Role.admin;
    if (user.roles.includes(Role.advisor)) return Role.advisor;
    return Role.promoter;
  }

  /** Soporte habilitado + actor con permiso (agente, o promotor con beneficios premium). */
  private async assertCanUse(user: AuthUser): Promise<void> {
    if (!(await this.supportEnabled())) {
      throw new ForbiddenException('El soporte está deshabilitado');
    }
    if (this.isAgent(user)) return;
    if (!user.roles.includes(Role.promoter)) {
      throw new ForbiddenException('Solo promotores pueden abrir tickets de soporte');
    }
    if (!(await this.premium.benefitsActive(user.userId))) {
      throw new ForbiddenException('El soporte con chat es un beneficio premium');
    }
  }

  // ---------------------------------------------------------------------------
  // Creación / lectura
  // ---------------------------------------------------------------------------

  /** El promotor abre un ticket (con el primer mensaje). Arranca el reloj SLA. */
  async createTicket(user: AuthUser, input: CreateTicketInput) {
    await this.assertCanUse(user);
    if (this.isAgent(user)) throw new ForbiddenException('Los agentes atienden tickets, no los abren');
    const now = new Date();
    const priority = input.priority ?? SupportPriority.medium;
    const { firstResponseDueAt, resolveDueAt } = initialDueDates(priority, now, await this.resolveSlaTargets());
    const ticket = await this.prisma.supportTicket.create({
      data: {
        promoterId: user.userId,
        subject: input.subject.trim(),
        category: input.category ?? SupportCategory.other,
        priority,
        status: SupportStatus.new,
        contextType: input.contextType ?? null,
        contextId: input.contextId ?? null,
        firstResponseDueAt,
        resolveDueAt,
        messages: {
          create: { senderId: user.userId, senderRole: Role.promoter, body: input.message.trim() },
        },
      },
      include: { messages: true },
    });
    this.gateway.emitMessage(ticket.id, ticket.messages[0]);
    await this.scheduleSla(ticket.id, 'first_response', firstResponseDueAt);
    await this.scheduleSla(ticket.id, 'resolution', resolveDueAt);
    await this.record('support.ticket.created', user.userId, ticket.id, {
      subject: ticket.subject,
      category: ticket.category,
      priority: ticket.priority,
    });
    return this.summarize(ticket);
  }

  /** Lista: el promotor ve los suyos NO archivados (o todos si includeArchived); el agente ve todos. */
  async listTickets(user: AuthUser, includeArchived = false) {
    await this.assertCanUse(user);
    const where: Prisma.SupportTicketWhereInput = this.isAgent(user)
      ? {}
      : { promoterId: user.userId, ...(includeArchived ? {} : { archivedByPromoterAt: null }) };
    const tickets = await this.prisma.supportTicket.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      include: { promoter: { select: { id: true, firstName: true, lastName: true, email: true } } },
      take: 100,
    });
    return tickets.map((t) => this.summarize(t));
  }

  /** Mensajes de un ticket (dueño promotor o agente). El promotor NO ve notas internas. IDOR → 404. */
  async getMessages(ticketId: string, user: AuthUser) {
    const ticket = await this.getAccessible(ticketId, user);
    const agent = this.isAgent(user);
    const messages = await this.prisma.supportMessage.findMany({
      where: { ticketId: ticket.id, ...(agent ? {} : { internalNote: false }) },
      orderBy: { createdAt: 'asc' },
      include: { attachments: true },
    });
    // Marca leído del lado que abre el historial.
    await this.prisma.supportMessage.updateMany({
      where: agent
        ? { ticketId: ticket.id, readByAgentAt: null }
        : { ticketId: ticket.id, internalNote: false, readByPromoterAt: null },
      data: agent ? { readByAgentAt: new Date() } : { readByPromoterAt: new Date() },
    });
    return { ticket: this.summarize(ticket), messages: await this.withAttachmentUrls(messages) };
  }

  // ---------------------------------------------------------------------------
  // Mensajes (auto-transiciones de estado + SLA)
  // ---------------------------------------------------------------------------

  /** Genera una URL firmada de subida para un adjunto del ticket (agente o dueño). IDOR → 404. */
  async presignAttachment(ticketId: string, user: AuthUser, filename: string, mime: string) {
    await this.getAccessible(ticketId, user);
    if (!ATTACH_ALLOWED_MIME.has(mime)) {
      throw new BadRequestException('Tipo de archivo no permitido');
    }
    const safe = filename.replace(/[^\w.-]+/g, '_').slice(-80);
    const key = `support/${ticketId}/${randomUUID()}-${safe}`;
    const uploadUrl = await this.storage.signedPutUrl(key, mime);
    return { key, uploadUrl };
  }

  /** Publica un mensaje (con adjuntos opcionales). Agente → awaiting_promoter; promotor → awaiting_support. */
  async postMessage(
    ticketId: string,
    user: AuthUser,
    body: string,
    internalNote = false,
    attachments: AttachmentInput[] = [],
  ) {
    const ticket = await this.getAccessible(ticketId, user);
    const agent = this.isAgent(user);
    if (internalNote && !agent) throw new ForbiddenException('Solo los agentes escriben notas internas');
    if (!internalNote && isFinal(ticket.status)) {
      throw new ForbiddenException('El ticket está cerrado');
    }
    this.validateAttachments(ticket.id, attachments);
    const senderRole = this.senderRoleOf(user);
    const message = await this.prisma.supportMessage.create({
      data: {
        ticketId: ticket.id,
        senderId: user.userId,
        senderRole,
        body: body.trim(),
        internalNote,
        attachments: attachments.length
          ? { create: attachments.map((a) => ({ storageKey: a.key, filename: a.filename, mime: a.mime, size: a.size })) }
          : undefined,
      },
      include: { attachments: true },
    });
    await this.prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { lastMessageAt: new Date() },
    });
    const withUrls = (await this.withAttachmentUrls([message]))[0];
    this.gateway.emitMessage(ticket.id, withUrls);

    // Nota interna: no cambia estado ni SLA.
    if (internalNote) return withUrls;

    if (agent) {
      // 1ª respuesta del agente: marca SLA de primera respuesta y espera al promotor.
      const patch: Prisma.SupportTicketUpdateInput = {};
      if (!ticket.firstRespondedAt) patch.firstRespondedAt = new Date();
      await this.transition(ticket.id, SupportStatus.awaiting_promoter, patch);
    } else {
      // El promotor responde. Si el ticket estaba resuelto dentro de la ventana → reabre.
      const resolvedRecently =
        ticket.status === SupportStatus.resolved &&
        ticket.resolvedAt != null &&
        Date.now() - ticket.resolvedAt.getTime() <= REOPEN_WINDOW_MS;
      if (resolvedRecently) {
        await this.transition(ticket.id, SupportStatus.reopened, { resolvedAt: null });
      }
      // En cualquier caso, ahora espera al soporte (reloj corre) + limpia archivado.
      await this.transition(ticket.id, SupportStatus.awaiting_support, { archivedByPromoterAt: null });
    }
    return withUrls;
  }

  // ---------------------------------------------------------------------------
  // Transiciones explícitas (agente/admin salvo indicado)
  // ---------------------------------------------------------------------------

  /** (Agente) Toma un ticket sin asignar → open + assignee = él. */
  async take(ticketId: string, user: AuthUser) {
    await this.getAccessible(ticketId, user); // valida acceso (404 si no aplica)
    if (!this.isAgent(user)) throw new ForbiddenException('Solo un agente puede tomar el ticket');
    const updated = await this.transition(ticketId, SupportStatus.open, {
      assignedTo: { connect: { id: user.userId } },
    });
    await this.record('support.ticket.taken', user.userId, ticketId, {});
    return updated;
  }

  /** (Admin) Reasigna a un asesor/admin (handoff). */
  async assign(ticketId: string, assignedToId: string, actorId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    const agent = await this.prisma.user.findUnique({
      where: { id: assignedToId },
      select: { roles: true },
    });
    if (!agent || !(agent.roles.includes(Role.advisor) || agent.roles.includes(Role.admin))) {
      throw new ForbiddenException('Solo se puede asignar a un asesor o admin');
    }
    const to = ticket.status === SupportStatus.new ? SupportStatus.open : ticket.status;
    const updated = await this.transition(ticketId, to, { assignedTo: { connect: { id: assignedToId } } });
    await this.record('support.ticket.assigned', actorId, ticketId, { assignedToId });
    return updated;
  }

  /** (Agente) Marca resuelto. Detiene el reloj de resolución. */
  async resolve(ticketId: string, user: AuthUser) {
    await this.getAccessible(ticketId, user);
    if (!this.isAgent(user)) throw new ForbiddenException('Solo un agente resuelve el ticket');
    const updated = await this.transition(ticketId, SupportStatus.resolved, { resolvedAt: new Date() });
    await this.record('support.ticket.resolved', user.userId, ticketId, {});
    return updated;
  }

  /** Cierra el ticket (agente o el propio promotor). */
  async close(ticketId: string, user: AuthUser) {
    await this.getAccessible(ticketId, user);
    const updated = await this.transition(ticketId, SupportStatus.closed, { closedAt: new Date() });
    await this.record('support.ticket.closed', user.userId, ticketId, {});
    return updated;
  }

  /** (Agente/Admin) Reabre un ticket resuelto/cerrado → open. */
  async reopen(ticketId: string, user: AuthUser) {
    await this.getAccessible(ticketId, user);
    if (!this.isAgent(user)) throw new ForbiddenException('Solo un agente reabre el ticket');
    const updated = await this.transition(ticketId, SupportStatus.reopened, {
      resolvedAt: null,
      closedAt: null,
    });
    await this.record('support.ticket.reopened', user.userId, ticketId, {});
    return updated;
  }

  /** (Agente) Suspende: congela el ticket y el reloj SLA. */
  async suspend(ticketId: string, user: AuthUser) {
    await this.getAccessible(ticketId, user);
    if (!this.isAgent(user)) throw new ForbiddenException('Solo un agente suspende el ticket');
    const updated = await this.transition(ticketId, SupportStatus.suspended, { suspendedAt: new Date() });
    await this.record('support.ticket.suspended', user.userId, ticketId, {});
    return updated;
  }

  /** (Agente) Reanuda un ticket suspendido → awaiting_support (corre el reloj de nuevo). */
  async resumeTicket(ticketId: string, user: AuthUser) {
    await this.getAccessible(ticketId, user);
    if (!this.isAgent(user)) throw new ForbiddenException('Solo un agente reanuda el ticket');
    const updated = await this.transition(ticketId, SupportStatus.awaiting_support, {});
    await this.record('support.ticket.resumed', user.userId, ticketId, {});
    return updated;
  }

  /** (Agente) Cambia la prioridad → recalcula los vencimientos SLA pendientes desde ahora. */
  async setPriority(ticketId: string, priority: SupportPriority, user: AuthUser) {
    const ticket = await this.getAccessible(ticketId, user);
    if (!this.isAgent(user)) throw new ForbiddenException('Solo un agente cambia la prioridad');
    const now = new Date();
    const due = initialDueDates(priority, now, await this.resolveSlaTargets());
    const patch: Prisma.SupportTicketUpdateInput = { priority };
    if (!ticket.firstRespondedAt) {
      patch.firstResponseDueAt = due.firstResponseDueAt;
      patch.firstResponseBreachedAt = null;
    }
    if (!ticket.resolvedAt) {
      patch.resolveDueAt = due.resolveDueAt;
      patch.resolveBreachedAt = null;
    }
    const updated = await this.prisma.supportTicket.update({ where: { id: ticketId }, data: patch });
    if (slaRunning(updated.status) && !updated.slaPausedAt) {
      if (!updated.firstRespondedAt) await this.scheduleSla(ticketId, 'first_response', updated.firstResponseDueAt);
      if (!updated.resolvedAt) await this.scheduleSla(ticketId, 'resolution', updated.resolveDueAt);
    }
    this.gateway.emitTicket(ticketId, this.summarize(updated));
    await this.record('support.ticket.priority', user.userId, ticketId, { priority });
    return this.summarize(updated);
  }

  /** (Agente) Cambia la categoría. */
  async setCategory(ticketId: string, category: SupportCategory, user: AuthUser) {
    await this.getAccessible(ticketId, user);
    if (!this.isAgent(user)) throw new ForbiddenException('Solo un agente cambia la categoría');
    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { category },
    });
    this.gateway.emitTicket(ticketId, this.summarize(updated));
    await this.record('support.ticket.category', user.userId, ticketId, { category });
    return this.summarize(updated);
  }

  /** (Promotor dueño) ARCHIVA su ticket: lo oculta de su vista. NO borra (no-repudio). */
  async archive(ticketId: string, user: AuthUser) {
    const ticket = await this.getAccessible(ticketId, user);
    if (this.isAgent(user) || ticket.promoterId !== user.userId) {
      throw new ForbiddenException('Solo el promotor dueño archiva su ticket');
    }
    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { archivedByPromoterAt: new Date() },
    });
    await this.record('support.ticket.archived', user.userId, ticketId, {});
    return this.summarize(updated);
  }

  /** (Promotor dueño) Califica la atención (1..5) sobre un ticket resuelto/cerrado. */
  async rate(ticketId: string, user: AuthUser, score: number) {
    const ticket = await this.getAccessible(ticketId, user);
    if (this.isAgent(user) || ticket.promoterId !== user.userId) {
      throw new ForbiddenException('Solo el promotor dueño califica el ticket');
    }
    if (ticket.status !== SupportStatus.resolved && ticket.status !== SupportStatus.closed) {
      throw new ConflictException('Solo se califica un ticket resuelto o cerrado');
    }
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      throw new BadRequestException('La calificación debe ser un entero de 1 a 5');
    }
    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { csatScore: score },
    });
    await this.record('support.ticket.rated', user.userId, ticketId, { score });
    return this.summarize(updated);
  }

  // ---------------------------------------------------------------------------
  // Cola del agente (T2): filtros + keyset pagination (alto volumen)
  // ---------------------------------------------------------------------------

  /** (Agente) Cola de tickets con filtros y paginación por cursor. */
  async listQueue(user: AuthUser, filters: QueueFilters, page: KeysetQuery) {
    if (!this.isAgent(user)) throw new ForbiddenException('Solo agentes acceden a la cola');
    const where: Prisma.SupportTicketWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.priority) where.priority = filters.priority;
    if (filters.category) where.category = filters.category;
    if (filters.unassigned) where.assignedToId = null;
    else if (filters.mine) where.assignedToId = user.userId;
    else if (filters.assigneeId) where.assignedToId = filters.assigneeId;
    const rows = await this.prisma.supportTicket.findMany({
      where,
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      include: { promoter: { select: { id: true, firstName: true, lastName: true, email: true } } },
      ...keysetTake(page),
    });
    const result = keysetResult(rows, page);
    return { items: result.items.map((t) => this.summarize(t)), nextCursor: result.nextCursor };
  }

  // ---------------------------------------------------------------------------
  // Configuración de SLA (T2): el admin ajusta los objetivos por prioridad
  // ---------------------------------------------------------------------------

  /** Objetivos SLA efectivos (defaults + override del setting). */
  private async resolveSlaTargets(): Promise<SlaTargets> {
    const s = await this.prisma.setting.findUnique({ where: { key: SLA_SETTING_KEY } });
    return mergeSlaTargets(s?.value ?? null);
  }

  /** (Admin/agente) Lee la configuración SLA efectiva. */
  async getSlaConfig(): Promise<SlaTargets> {
    return this.resolveSlaTargets();
  }

  /** (Admin) Guarda overrides de SLA (se fusionan con los defaults; valores inválidos se ignoran). */
  async setSlaConfig(overrides: unknown, actorId: string): Promise<SlaTargets> {
    const merged = mergeSlaTargets(overrides);
    await this.prisma.setting.upsert({
      where: { key: SLA_SETTING_KEY },
      update: { value: merged as unknown as Prisma.InputJsonValue },
      create: {
        key: SLA_SETTING_KEY,
        value: merged as unknown as Prisma.InputJsonValue,
        description: 'Objetivos SLA de soporte por prioridad (T2)',
      },
    });
    await this.record('support.sla.config', actorId, SLA_SETTING_KEY, merged);
    return merged;
  }

  // ---------------------------------------------------------------------------
  // Motor de transición (valida + ajusta SLA + persiste + emite + audita el cambio)
  // ---------------------------------------------------------------------------

  private async transition(
    ticketId: string,
    to: SupportStatus,
    extra: Prisma.SupportTicketUpdateInput,
  ) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    if (!canTransition(ticket.status, to)) {
      throw new ConflictException(`Transición no permitida: ${ticket.status} → ${to}`);
    }
    const now = new Date();
    const data: Prisma.SupportTicketUpdateInput = { ...extra, status: to };

    const targetRunning = slaRunning(to);
    if (!targetRunning && !ticket.slaPausedAt) {
      // Entrando a un estado que pausa el reloj.
      data.slaPausedAt = now;
    } else if (targetRunning && ticket.slaPausedAt) {
      // Reanudando: corre los vencimientos por el tiempo pausado.
      const delta = now.getTime() - ticket.slaPausedAt.getTime();
      data.slaPausedAt = null;
      if (!ticket.firstRespondedAt) data.firstResponseDueAt = shiftDue(ticket.firstResponseDueAt, delta);
      if (!ticket.resolvedAt) data.resolveDueAt = shiftDue(ticket.resolveDueAt, delta);
    }

    const updated = await this.prisma.supportTicket.update({ where: { id: ticketId }, data });

    // Al (re)entrar a un estado con reloj corriendo, (re)programa los chequeos de breach.
    if (targetRunning) {
      if (!updated.firstRespondedAt) await this.scheduleSla(ticketId, 'first_response', updated.firstResponseDueAt);
      if (!updated.resolvedAt) await this.scheduleSla(ticketId, 'resolution', updated.resolveDueAt);
    }
    this.gateway.emitTicket(ticketId, this.summarize(updated));
    return this.summarize(updated);
  }

  // ---------------------------------------------------------------------------
  // SLA: jobs de incumplimiento (BullMQ delay + re-chequeo al disparar)
  // ---------------------------------------------------------------------------

  private async scheduleSla(ticketId: string, kind: SlaJob['kind'], dueAt: Date | null): Promise<void> {
    if (!dueAt) return;
    const delay = Math.max(0, dueAt.getTime() - Date.now());
    await this.queue.enqueue(QUEUES.SUPPORT, 'sla-check', { ticketId, kind }, { delay });
  }

  /**
   * Se dispara en el vencimiento. RE-CHEQUEA el estado actual (el reloj pudo pausarse
   * o el objetivo cumplirse). Si sigue corriendo y ya venció → alerta (correo + audit),
   * marca el breach (idempotente). Si aún no vence (se corrió por pausa) → reprograma.
   */
  async checkSlaBreach(job: SlaJob): Promise<void> {
    const t = await this.prisma.supportTicket.findUnique({
      where: { id: job.ticketId },
      include: { promoter: { select: { firstName: true, email: true } } },
    });
    if (!t) return;
    if (isFinal(t.status) || t.slaPausedAt || !slaRunning(t.status)) return; // pausado/cerrado → no penaliza

    if (job.kind === 'first_response') {
      if (t.firstRespondedAt || t.firstResponseBreachedAt || !t.firstResponseDueAt) return;
      if (Date.now() < t.firstResponseDueAt.getTime()) {
        return this.scheduleSla(t.id, 'first_response', t.firstResponseDueAt); // se corrió por una pausa
      }
      await this.prisma.supportTicket.update({ where: { id: t.id }, data: { firstResponseBreachedAt: new Date() } });
      await this.alertAgents(t, 'primera respuesta');
      await this.record('support.sla.first_response_breached', null, t.id, { priority: t.priority });
    } else {
      if (t.resolvedAt || t.resolveBreachedAt || !t.resolveDueAt) return;
      if (Date.now() < t.resolveDueAt.getTime()) {
        return this.scheduleSla(t.id, 'resolution', t.resolveDueAt);
      }
      await this.prisma.supportTicket.update({ where: { id: t.id }, data: { resolveBreachedAt: new Date() } });
      await this.alertAgents(t, 'resolución');
      await this.record('support.sla.resolution_breached', null, t.id, { priority: t.priority });
    }
  }

  /** Correo a asesores+admins activos avisando del incumplimiento de SLA (o falta de respuesta). */
  private async alertAgents(
    ticket: { id: string; subject: string; promoter?: { firstName: string | null; email: string } | null },
    slaLabel: string,
  ): Promise<void> {
    const agents = await this.prisma.user.findMany({
      where: { roles: { hasSome: [Role.admin, Role.advisor] }, status: 'active' },
      select: { email: true },
    });
    const subject = `SLA de ${slaLabel} vencido: ${ticket.subject}`;
    const html =
      `<p>El ticket de <b>${ticket.promoter?.firstName ?? ''}</b> (${ticket.promoter?.email ?? ''}) ` +
      `superó su SLA de <b>${slaLabel}</b> sin atención.</p><p>Asunto: <b>${ticket.subject}</b></p>`;
    for (const a of agents) {
      await this.mail
        .send({ to: a.email, subject, html })
        .catch((e) => this.logger.warn(`alerta SLA a ${a.email}: ${(e as Error).message}`));
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Valida los adjuntos: tipo permitido, tamaño y que la key pertenezca a ESTE ticket. */
  private validateAttachments(ticketId: string, attachments: AttachmentInput[]): void {
    for (const a of attachments) {
      if (!ATTACH_ALLOWED_MIME.has(a.mime)) throw new BadRequestException('Tipo de archivo no permitido');
      if (!(a.size > 0) || a.size > ATTACH_MAX_BYTES) throw new BadRequestException('Archivo demasiado grande');
      if (!a.key.startsWith(`support/${ticketId}/`)) throw new BadRequestException('Adjunto inválido');
    }
  }

  /** Añade a cada mensaje sus adjuntos con URL firmada de descarga (corta duración). */
  private async withAttachmentUrls<
    M extends { attachments?: { id: string; storageKey: string; filename: string; mime: string; size: number }[] },
  >(messages: M[]) {
    return Promise.all(
      messages.map(async (m) => ({
        ...m,
        attachments: await Promise.all(
          (m.attachments ?? []).map(async (a) => ({
            id: a.id,
            filename: a.filename,
            mime: a.mime,
            size: a.size,
            url: await this.storage.signedGetUrl(a.storageKey),
          })),
        ),
      })),
    );
  }

  // ---------------------------------------------------------------------------
  // Métricas (T4): panel del agente / dashboard de soporte
  // ---------------------------------------------------------------------------

  /** (Agente) Resumen operativo: volumen por estado/categoría/prioridad, SLA y CSAT. */
  async metrics(user: AuthUser) {
    if (!this.isAgent(user)) throw new ForbiddenException('Solo agentes ven las métricas');
    const [byStatus, byCategory, byPriority, unassigned, breachedFirst, breachedRes, csat, resolvedAgg] =
      await Promise.all([
        this.prisma.supportTicket.groupBy({ by: ['status'], _count: true }),
        this.prisma.supportTicket.groupBy({ by: ['category'], _count: true }),
        this.prisma.supportTicket.groupBy({ by: ['priority'], _count: true }),
        this.prisma.supportTicket.count({ where: { assignedToId: null, status: { notIn: ['closed', 'resolved'] } } }),
        this.prisma.supportTicket.count({ where: { firstResponseBreachedAt: { not: null } } }),
        this.prisma.supportTicket.count({ where: { resolveBreachedAt: { not: null } } }),
        this.prisma.supportTicket.aggregate({ _avg: { csatScore: true }, _count: { csatScore: true } }),
        this.prisma.supportTicket.count({ where: { resolvedAt: { not: null } } }),
      ]);
    type GroupRow = { _count: number } & Record<string, string | number | null>;
    const toMap = (rows: GroupRow[], key: string): Record<string, number> =>
      Object.fromEntries(rows.map((r) => [String(r[key]), r._count]));
    return {
      byStatus: toMap(byStatus as unknown as GroupRow[], 'status'),
      byCategory: toMap(byCategory as unknown as GroupRow[], 'category'),
      byPriority: toMap(byPriority as unknown as GroupRow[], 'priority'),
      unassigned,
      slaBreach: { firstResponse: breachedFirst, resolution: breachedRes },
      csat: { avg: csat._avg.csatScore ? Number(csat._avg.csatScore.toFixed(2)) : null, count: csat._count.csatScore },
      resolvedTotal: resolvedAgg,
    };
  }

  // ---------------------------------------------------------------------------
  // Auto-cierre (T4): cierra tickets resueltos que llevan mucho sin actividad
  // ---------------------------------------------------------------------------

  /** Cierra tickets `resolved` cuya resolución superó `days` (idempotente). Devuelve cuántos cerró. */
  async autoCloseResolved(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 3_600_000);
    const stale = await this.prisma.supportTicket.findMany({
      where: { status: SupportStatus.resolved, resolvedAt: { lt: cutoff } },
      select: { id: true },
    });
    for (const t of stale) {
      await this.transition(t.id, SupportStatus.closed, { closedAt: new Date() }).catch(() => undefined);
      await this.record('support.ticket.auto_closed', null, t.id, { days });
    }
    return stale.length;
  }

  /** Ticket accesible por el usuario (dueño promotor o agente). IDOR → 404. */
  private async getAccessible(ticketId: string, user: AuthUser) {
    await this.assertCanUse(user);
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    if (!this.isAgent(user) && ticket.promoterId !== user.userId) {
      throw new NotFoundException('Ticket no encontrado'); // IDOR → 404
    }
    return ticket;
  }

  private async record(
    action: string,
    userId: string | null,
    resource: string,
    payload: unknown,
  ): Promise<void> {
    await this.audit
      .record({ userId, action, resource, payload })
      .catch((e) => this.logger.warn(`audit ${action}: ${(e as Error).message}`));
  }

  private summarize(t: {
    id: string;
    promoterId: string;
    subject: string;
    category: SupportCategory;
    priority: SupportPriority;
    status: SupportStatus;
    assignedToId: string | null;
    contextType: SupportContextType | null;
    contextId: string | null;
    firstResponseDueAt: Date | null;
    resolveDueAt: Date | null;
    firstRespondedAt: Date | null;
    resolvedAt: Date | null;
    closedAt: Date | null;
    csatScore: number | null;
    archivedByPromoterAt: Date | null;
    lastMessageAt: Date;
    createdAt: Date;
    promoter?: { id: string; firstName: string; lastName: string | null; email: string } | null;
  }) {
    return {
      id: t.id,
      promoterId: t.promoterId,
      subject: t.subject,
      category: t.category,
      priority: t.priority,
      status: t.status,
      assignedToId: t.assignedToId,
      contextType: t.contextType ?? undefined,
      contextId: t.contextId ?? undefined,
      firstResponseDueAt: t.firstResponseDueAt ?? undefined,
      resolveDueAt: t.resolveDueAt ?? undefined,
      firstRespondedAt: t.firstRespondedAt ?? undefined,
      resolvedAt: t.resolvedAt ?? undefined,
      closedAt: t.closedAt ?? undefined,
      csatScore: t.csatScore ?? undefined,
      archived: t.archivedByPromoterAt != null,
      lastMessageAt: t.lastMessageAt,
      createdAt: t.createdAt,
      promoter: t.promoter ?? undefined,
    };
  }
}
