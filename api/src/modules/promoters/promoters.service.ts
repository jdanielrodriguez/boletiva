import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PromoterStatus, Role, User } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService } from '../../infra/queue/queue.service';
import { QUEUES } from '../../infra/queue/queue.constants';
import type { PromoterMailStatus } from './promoter-mail.service';

const REQUIRE_KEY = 'promoters.require_approval';

/**
 * Autorización de promotores (Ola 4). Cualquier usuario puede SOLICITAR ser
 * promotor; un admin lo aprueba/rechaza/suspende antes de que pueda operar
 * (crear/publicar eventos). El "modo pruebas" (setting `promoters.require_approval`
 * = false) AUTO-APRUEBA al solicitar — útil para alpha/beta.
 */
@Injectable()
export class PromotersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  /** Encola (cola MAIL) el correo del estado de promotor. Nunca bloquea/lanza. */
  private async notify(userId: string, status: PromoterMailStatus, note?: string | null) {
    await this.queue.enqueue(QUEUES.MAIL, 'promoter-status', { userId, status, note: note ?? null });
  }

  /** ¿Se exige autorización del admin? (true por defecto; false = modo pruebas). */
  async requireApproval(): Promise<boolean> {
    const s = await this.prisma.setting.findUnique({ where: { key: REQUIRE_KEY } });
    if (s == null) return true;
    return s.value === true;
  }

  /** Botón "Activar pruebas": setRequireApproval(false) desactiva la autorización. */
  async setRequireApproval(value: boolean): Promise<{ requireApproval: boolean }> {
    await this.prisma.setting.upsert({
      where: { key: REQUIRE_KEY },
      update: { value },
      create: {
        key: REQUIRE_KEY,
        value,
        description: 'Exigir autorización de admin para operar como promotor (false = modo pruebas)',
      },
    });
    return { requireApproval: value };
  }

  /** Un usuario solicita ser promotor. Idempotente; auto-aprueba en modo pruebas. */
  async apply(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.promoterStatus === PromoterStatus.approved) return this.summarize(user);

    if (!(await this.requireApproval())) {
      const updated = await this.grant(user); // modo pruebas → aprobado al instante
      await this.notify(userId, 'approved');
      return this.summarize(updated);
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        promoterStatus: PromoterStatus.pending,
        promoterAppliedAt: user.promoterAppliedAt ?? new Date(),
        promoterDecidedAt: null,
        promoterNote: null,
      },
    });
    await this.notify(userId, 'pending'); // "recibimos tu solicitud, pronto te contactarán"
    return this.summarize(updated);
  }

  /** Estado de promotor del usuario autenticado (+ si el modo pruebas está activo). */
  async myStatus(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { ...this.summarize(user), requireApproval: await this.requireApproval() };
  }

  /** Lista de solicitudes (admin). Filtra por estado; excluye 'none' por defecto. */
  async list(status?: PromoterStatus) {
    return this.prisma.user.findMany({
      where: status ? { promoterStatus: status } : { promoterStatus: { not: PromoterStatus.none } },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        roles: true,
        promoterStatus: true,
        promoterAppliedAt: true,
        promoterDecidedAt: true,
        promoterNote: true,
        promoterInternalNote: true,
      },
      orderBy: { promoterAppliedAt: 'asc' },
    });
  }

  /**
   * Nota interna del admin sobre un promotor (v3.8). Persistente e independiente
   * del motivo de la última decisión (`promoterNote`). null = borrar la nota.
   */
  async setInternalNote(id: string, note: string | null) {
    await this.getUser(id); // 404 si no existe
    const updated = await this.prisma.user.update({
      where: { id },
      data: { promoterInternalNote: note ?? null },
    });
    return { id: updated.id, promoterInternalNote: updated.promoterInternalNote };
  }

  async approve(id: string, adminId?: string) {
    const user = await this.getUser(id);
    const updated = await this.grant(user);
    await this.audit(user, PromoterStatus.approved, adminId, null);
    await this.notify(user.id, 'approved');
    return this.summarize(updated);
  }

  /** Auto-aprueba a un usuario que aceptó una invitación por token (F4). */
  async autoApprove(userId: string) {
    const user = await this.getUser(userId);
    const updated = await this.grant(user);
    await this.audit(user, PromoterStatus.approved, null, 'Invitación por token');
    return this.summarize(updated);
  }

  async reject(id: string, note?: string, adminId?: string) {
    const user = await this.getUser(id);
    const updated = await this.revoke(user, PromoterStatus.rejected, note);
    await this.audit(user, PromoterStatus.rejected, adminId, note);
    await this.notify(user.id, 'rejected', note);
    return this.summarize(updated);
  }

  async suspend(id: string, note?: string, adminId?: string) {
    const user = await this.getUser(id);
    const updated = await this.revoke(user, PromoterStatus.suspended, note);
    await this.audit(user, PromoterStatus.suspended, adminId, note);
    await this.notify(user.id, 'suspended', note);
    return this.summarize(updated);
  }

  /**
   * Historial del promotor (admin): línea de tiempo unificada de dos tipos de evento
   * (`kind`): transiciones de ESTADO (`promoter_status_events`) y LIQUIDACIONES de caja
   * (cierre de evento que transfirió su neto al wallet del promotor, del ledger
   * `event_cash_transfer`). Ordenado por fecha desc. Append-only en ambos casos.
   */
  async history(id: string) {
    await this.getUser(id); // 404 si no existe

    const statusEvents = await this.prisma.promoterStatusEvent.findMany({
      where: { promoterId: id },
      orderBy: { createdAt: 'desc' },
    });

    // Liquidaciones: eventos del promotor con caja transferida + su asiento en el ledger.
    const settledEvents = await this.prisma.event.findMany({
      where: { promoterId: id, cashTransferredAt: { not: null } },
      select: { id: true, name: true },
    });
    const eventById = new Map(settledEvents.map((e) => [e.id, e.name]));
    const transfers = settledEvents.length
      ? await this.prisma.ledgerTransaction.findMany({
          where: { kind: 'event_cash_transfer', refType: 'event', refId: { in: [...eventById.keys()] } },
          include: { entries: true },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    const statusItems = statusEvents.map((e) => ({
      id: e.id,
      kind: 'status' as const,
      createdAt: e.createdAt,
      adminId: e.adminId as string | null,
      statusFrom: e.statusFrom as string | null,
      statusTo: e.statusTo as string | null,
      reason: e.reason,
      eventName: null as string | null,
      amount: null as string | null,
    }));

    const settlementItems = transfers.map((t) => {
      // El asiento positivo (a user_wallet) es el neto transferido al promotor.
      const credited = t.entries.reduce((max, en) => (Number(en.amount) > max ? Number(en.amount) : max), 0);
      return {
        id: t.id,
        kind: 'settlement' as const,
        createdAt: t.createdAt,
        adminId: null as string | null,
        statusFrom: null as string | null,
        statusTo: null as string | null,
        reason: t.memo ?? null,
        eventName: (t.refId && eventById.get(t.refId)) || null,
        amount: credited.toFixed(2),
      };
    });

    return [...statusItems, ...settlementItems].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  /** Asienta una transición en el historial append-only (nunca se edita/borra). */
  private async audit(
    user: { id: string; promoterStatus: PromoterStatus },
    statusTo: PromoterStatus,
    adminId?: string | null,
    reason?: string | null,
  ): Promise<void> {
    await this.prisma.promoterStatusEvent.create({
      data: {
        promoterId: user.id,
        adminId: adminId ?? null,
        statusFrom: user.promoterStatus,
        statusTo,
        reason: reason ?? null,
      },
    });
  }

  /**
   * Enforcement: solo un promotor APROBADO (o un admin) puede operar. Lo llaman
   * los flujos de negocio del promotor (crear/publicar eventos).
   */
  async assertCanOperate(userId: string): Promise<void> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { roles: true, promoterStatus: true },
    });
    if (!u) throw new ForbiddenException('Usuario no encontrado');
    if (u.roles.includes(Role.admin)) return;
    if (u.promoterStatus !== PromoterStatus.approved) {
      throw new ForbiddenException(
        'Tu cuenta de promotor no está autorizada por un administrador',
      );
    }
  }

  /** Aprueba: estado approved + asegura el rol promoter. */
  private grant(user: User) {
    const roles = user.roles.includes(Role.promoter) ? user.roles : [...user.roles, Role.promoter];
    return this.prisma.user.update({
      where: { id: user.id },
      data: {
        promoterStatus: PromoterStatus.approved,
        promoterAppliedAt: user.promoterAppliedAt ?? new Date(),
        promoterDecidedAt: new Date(),
        promoterNote: null,
        roles,
      },
    });
  }

  /** Rechaza/suspende: quita el rol promoter para que el RBAC lo bloquee. */
  private revoke(user: User, status: PromoterStatus, note?: string) {
    return this.prisma.user.update({
      where: { id: user.id },
      data: {
        promoterStatus: status,
        promoterDecidedAt: new Date(),
        promoterNote: note ?? null,
        roles: user.roles.filter((r) => r !== Role.promoter),
      },
    });
  }

  private async getUser(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  // NOTA: `summarize` es la vista PÚBLICA/propia (la usa `apply`/`myStatus`), por lo
  // que NO incluye `promoterInternalNote` (nota privada del admin) para no filtrarla
  // al propio promotor. La nota solo se expone en endpoints admin (list + setInternalNote).
  private summarize(u: {
    id: string;
    promoterStatus: PromoterStatus;
    promoterAppliedAt: Date | null;
    promoterDecidedAt: Date | null;
    promoterNote: string | null;
  }) {
    return {
      id: u.id,
      promoterStatus: u.promoterStatus,
      promoterAppliedAt: u.promoterAppliedAt,
      promoterDecidedAt: u.promoterDecidedAt,
      promoterNote: u.promoterNote,
    };
  }
}
