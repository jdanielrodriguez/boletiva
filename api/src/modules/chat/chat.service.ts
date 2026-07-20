import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ChatThreadStatus, Role } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService } from '../../infra/queue/queue.service';
import { QUEUES } from '../../infra/queue/queue.constants';
import { MailService } from '../../infra/mail/mail.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PremiumService } from '../promoters/premium.service';
import { ChatGateway } from './chat.gateway';

/** Minutos que se le dan a un agente para responder antes del correo al admin. */
const FALLBACK_DELAY_MS = 2 * 60_000;

/**
 * Chat de soporte (B3). TICKETS (hilos) por promotor PREMIUM ↔ asesor/admin, con
 * estado abierto/cerrado + historial. Entrega en vivo por socket.io (ChatGateway) y
 * RUTEO con fallback: si a un mensaje del promotor nadie responde en 2 min → correo
 * al admin (cola CHAT). Gating: `chat.enabled` global + beneficios premium del promotor.
 */
@Injectable()
export class ChatService implements OnModuleInit {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly mail: MailService,
    private readonly premium: PremiumService,
    private readonly gateway: ChatGateway,
  ) {}

  onModuleInit(): void {
    this.queue.registerHandler(QUEUES.CHAT, (name, data) => this.handleJob(name, data));
  }

  private async handleJob(name: string, data: unknown): Promise<void> {
    if (name === 'fallback') await this.emailFallback((data as { threadId: string }).threadId);
  }

  private async chatEnabled(): Promise<boolean> {
    const s = await this.prisma.setting.findUnique({ where: { key: 'chat.enabled' } });
    return s?.value === true;
  }

  private isAgent(user: AuthUser): boolean {
    return user.roles.includes(Role.admin) || user.roles.includes(Role.advisor);
  }

  /** El chat debe estar habilitado y el actor debe poder usarlo (agente o promotor premium). */
  private async assertCanUseChat(user: AuthUser): Promise<void> {
    if (!(await this.chatEnabled())) throw new ForbiddenException('El chat de soporte está deshabilitado');
    if (this.isAgent(user)) return;
    if (!user.roles.includes(Role.promoter)) {
      throw new ForbiddenException('Solo promotores pueden usar el chat de soporte');
    }
    if (!(await this.premium.benefitsActive(user.userId))) {
      throw new ForbiddenException('El chat de soporte es un beneficio premium');
    }
  }

  /** El promotor abre un hilo (con el primer mensaje). Dispara el fallback. */
  async createThread(user: AuthUser, subject: string, message: string) {
    await this.assertCanUseChat(user);
    if (this.isAgent(user)) throw new ForbiddenException('Los agentes responden hilos, no los abren');
    const thread = await this.prisma.chatThread.create({
      data: {
        promoterId: user.userId,
        subject: subject.trim(),
        messages: { create: { senderId: user.userId, senderRole: Role.promoter, body: message.trim() } },
      },
      include: { messages: true },
    });
    this.gateway.emitMessage(thread.id, thread.messages[0]);
    await this.scheduleFallback(thread.id);
    return this.summarize(thread);
  }

  /** Lista de hilos: el promotor ve los suyos; el agente ve todos (recientes primero). */
  async listThreads(user: AuthUser) {
    await this.assertCanUseChat(user);
    const where = this.isAgent(user) ? {} : { promoterId: user.userId };
    const threads = await this.prisma.chatThread.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      include: { promoter: { select: { id: true, firstName: true, lastName: true, email: true } } },
      take: 100,
    });
    return threads.map((t) => this.summarize(t));
  }

  /** Mensajes de un hilo (dueño promotor o agente). IDOR → 404. */
  async getMessages(threadId: string, user: AuthUser) {
    const thread = await this.getAccessible(threadId, user);
    const messages = await this.prisma.chatMessage.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: 'asc' },
    });
    return { thread: this.summarize(thread), messages };
  }

  /** Publica un mensaje. Agente → marca respondido; promotor → reprograma el fallback. */
  async postMessage(threadId: string, user: AuthUser, body: string) {
    const thread = await this.getAccessible(threadId, user);
    if (thread.status === ChatThreadStatus.closed) {
      throw new ForbiddenException('El hilo está cerrado');
    }
    const senderRole = this.isAgent(user)
      ? user.roles.includes(Role.admin)
        ? Role.admin
        : Role.advisor
      : Role.promoter;
    const message = await this.prisma.chatMessage.create({
      data: { threadId: thread.id, senderId: user.userId, senderRole, body: body.trim() },
    });
    await this.prisma.chatThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: new Date(), answered: senderRole !== Role.promoter },
    });
    this.gateway.emitMessage(thread.id, message);
    if (senderRole === Role.promoter) await this.scheduleFallback(thread.id);
    return message;
  }

  async close(threadId: string, user: AuthUser) {
    const thread = await this.getAccessible(threadId, user);
    const updated = await this.prisma.chatThread.update({
      where: { id: thread.id },
      data: { status: ChatThreadStatus.closed },
    });
    this.gateway.emitThread(thread.id, this.summarize(updated));
    return this.summarize(updated);
  }

  async reopen(threadId: string, user: AuthUser) {
    const thread = await this.getAccessible(threadId, user);
    const updated = await this.prisma.chatThread.update({
      where: { id: thread.id },
      data: { status: ChatThreadStatus.open },
    });
    this.gateway.emitThread(thread.id, this.summarize(updated));
    return this.summarize(updated);
  }

  /** (Admin) Reasigna el hilo a un asesor (handoff). */
  async assign(threadId: string, assignedToId: string) {
    const thread = await this.prisma.chatThread.findUnique({ where: { id: threadId } });
    if (!thread) throw new NotFoundException('Hilo no encontrado');
    const agent = await this.prisma.user.findUnique({ where: { id: assignedToId }, select: { roles: true } });
    if (!agent || !(agent.roles.includes(Role.advisor) || agent.roles.includes(Role.admin))) {
      throw new ForbiddenException('Solo se puede asignar a un asesor o admin');
    }
    const updated = await this.prisma.chatThread.update({
      where: { id: threadId },
      data: { assignedToId },
    });
    this.gateway.emitThread(threadId, this.summarize(updated));
    return this.summarize(updated);
  }

  /** Encola el correo-fallback con retardo (async) o lo corre al instante (inline/test). */
  private async scheduleFallback(threadId: string): Promise<void> {
    await this.queue.enqueue(QUEUES.CHAT, 'fallback', { threadId }, { delay: FALLBACK_DELAY_MS });
  }

  /** Si tras el retardo el hilo sigue sin respuesta (ni cerrado) → correo a los admins. */
  async emailFallback(threadId: string): Promise<void> {
    const thread = await this.prisma.chatThread.findUnique({
      where: { id: threadId },
      include: { promoter: { select: { firstName: true, email: true } } },
    });
    if (!thread || thread.answered || thread.status === ChatThreadStatus.closed) return;
    const admins = await this.prisma.user.findMany({
      where: { roles: { has: Role.admin }, status: 'active' },
      select: { email: true },
    });
    const subject = `Chat de soporte sin responder: ${thread.subject}`;
    const html =
      `<p>El promotor <b>${thread.promoter?.firstName ?? ''}</b> (${thread.promoter?.email ?? ''}) ` +
      `abrió un chat de soporte y nadie respondió.</p><p>Asunto: <b>${thread.subject}</b></p>`;
    for (const a of admins) {
      await this.mail
        .send({ to: a.email, subject, html })
        .catch((e) => this.logger.warn(`fallback chat mail a ${a.email}: ${(e as Error).message}`));
    }
  }

  /** Hilo accesible por el usuario (dueño promotor o agente). IDOR → 404. */
  private async getAccessible(threadId: string, user: AuthUser) {
    await this.assertCanUseChat(user);
    const thread = await this.prisma.chatThread.findUnique({ where: { id: threadId } });
    if (!thread) throw new NotFoundException('Hilo no encontrado');
    if (!this.isAgent(user) && thread.promoterId !== user.userId) {
      throw new NotFoundException('Hilo no encontrado'); // IDOR → 404
    }
    return thread;
  }

  private summarize(t: {
    id: string;
    promoterId: string;
    subject: string;
    status: ChatThreadStatus;
    assignedToId: string | null;
    answered: boolean;
    lastMessageAt: Date;
    createdAt: Date;
    promoter?: { id: string; firstName: string; lastName: string | null; email: string } | null;
  }) {
    return {
      id: t.id,
      promoterId: t.promoterId,
      subject: t.subject,
      status: t.status,
      assignedToId: t.assignedToId,
      answered: t.answered,
      lastMessageAt: t.lastMessageAt,
      createdAt: t.createdAt,
      promoter: t.promoter ?? undefined,
    };
  }
}
