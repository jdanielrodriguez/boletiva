import { Injectable } from '@nestjs/common';
import { EmailStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { keysetResult, keysetTake } from '../../common/utils/pagination';
import { EmailLogQueryDto } from './dto/email-log.dto';

/**
 * Consulta del registro de correos (`email_logs`). Filtros + búsqueda 100%
 * SERVER-SIDE con paginación keyset (mandato data server-side). Solo lectura.
 */
@Injectable()
export class EmailLogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: EmailLogQueryDto) {
    const where: Prisma.EmailLogWhereInput = {};
    if (query.status) where.status = query.status as EmailStatus;
    if (query.type) where.type = { contains: query.type.trim(), mode: 'insensitive' };
    const search = query.search?.trim();
    if (search) where.recipient = { contains: search, mode: 'insensitive' };
    // Rango por fecha de creación (ISO YYYY-MM-DD; `to` inclusive).
    const from = parseDate(query.from);
    const to = parseDate(query.to, true);
    if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

    const rows = await this.prisma.emailLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...keysetTake(query),
    });
    const page = keysetResult(rows, query);
    return {
      items: page.items.map((r) => ({
        id: r.id,
        recipient: r.recipient,
        type: r.type,
        subject: r.subject,
        status: r.status,
        error: r.error,
        createdAt: r.createdAt.toISOString(),
        sentAt: r.sentAt?.toISOString() ?? null,
      })),
      nextCursor: page.nextCursor,
    };
  }
}

/** Parsea ISO YYYY-MM-DD → Date; `endOfDay` la lleva al último instante del día. */
function parseDate(v: string | undefined, endOfDay = false): Date | null {
  if (!v) return null;
  const d = new Date(endOfDay ? `${v}T23:59:59.999` : `${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
