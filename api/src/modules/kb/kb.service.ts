import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ContentStatus, KbVisibility, Prisma, SupportCategory } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { sanitizeRichHtml, stripHtml } from '../../common/utils/html';
import {
  CreateKbArticleDto,
  KbListQueryDto,
  UpdateKbArticleDto,
} from './dto/kb.dto';

/** Genera un slug URL-safe desde un texto (sin acentos, kebab-case). */
function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

/**
 * Base de Conocimientos (T6). Fuente de verdad para el FAQ público y para el chat/bot
 * (vía KbAutoResponder). `answerHtml` se SANEA a un subconjunto seguro al guardar y se
 * deriva `answerText` (plano) para búsqueda y JSON-LD. Estados draft/published; la
 * visibilidad public (FAQ) o internal (solo agentes/bot). Gestión: admin/asesor.
 */
@Injectable()
export class KbService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Público (FAQ) ----

  /** Artículos PUBLICADOS y PÚBLICOS, con filtro por categoría/idioma/búsqueda. */
  async listPublic(query: KbListQueryDto) {
    const where: Prisma.KbArticleWhereInput = {
      status: ContentStatus.published,
      visibility: KbVisibility.public,
    };
    if (query.category) where.category = query.category;
    if (query.locale) where.locale = query.locale;
    if (query.q?.trim()) {
      const q = query.q.trim();
      where.OR = [
        { question: { contains: q, mode: 'insensitive' } },
        { answerText: { contains: q, mode: 'insensitive' } },
        { tags: { has: q.toLowerCase() } },
      ];
    }
    const items = await this.prisma.kbArticle.findMany({
      where,
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { question: 'asc' }],
    });
    return items.map((a) => this.toPublic(a));
  }

  /** Detalle público por slug (publicado+público). Incrementa el contador de vistas. */
  async getPublicBySlug(slug: string) {
    const article = await this.prisma.kbArticle.findFirst({
      where: { slug, status: ContentStatus.published, visibility: KbVisibility.public },
    });
    if (!article) throw new NotFoundException('Artículo no encontrado');
    // Contador best-effort (no bloquea ni falla la lectura).
    await this.prisma.kbArticle
      .update({ where: { id: article.id }, data: { viewCount: { increment: 1 } } })
      .catch(() => undefined);
    return this.toPublic(article);
  }

  private toPublic(a: {
    slug: string;
    question: string;
    answerHtml: string;
    category: SupportCategory | null;
    tags: string[];
  }) {
    return {
      slug: a.slug,
      question: a.question,
      answerHtml: a.answerHtml,
      category: a.category,
      tags: a.tags,
    };
  }

  // ---- Gestión (admin/asesor) ----

  /** Listado completo para gestión (cualquier estado/visibilidad). */
  adminList(query: KbListQueryDto) {
    const where: Prisma.KbArticleWhereInput = {};
    if (query.category) where.category = query.category;
    if (query.locale) where.locale = query.locale;
    if (query.q?.trim()) {
      where.OR = [
        { question: { contains: query.q.trim(), mode: 'insensitive' } },
        { answerText: { contains: query.q.trim(), mode: 'insensitive' } },
      ];
    }
    return this.prisma.kbArticle.findMany({ where, orderBy: { updatedAt: 'desc' } });
  }

  async adminGet(id: string) {
    const a = await this.prisma.kbArticle.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Artículo no encontrado');
    return a;
  }

  async create(dto: CreateKbArticleDto, actorId: string) {
    const answerHtml = sanitizeRichHtml(dto.answerHtml);
    const slug = await this.uniqueSlug(dto.slug?.trim() || slugify(dto.question));
    return this.prisma.kbArticle.create({
      data: {
        slug,
        question: dto.question.trim(),
        answerHtml,
        answerText: stripHtml(answerHtml),
        category: dto.category ?? null,
        locale: dto.locale ?? 'es',
        visibility: dto.visibility ?? KbVisibility.public,
        tags: (dto.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
        sortOrder: dto.sortOrder ?? 0,
        createdById: actorId,
      },
    });
  }

  async update(id: string, dto: UpdateKbArticleDto) {
    await this.adminGet(id);
    const data: Prisma.KbArticleUpdateInput = {};
    if (dto.question !== undefined) data.question = dto.question.trim();
    if (dto.answerHtml !== undefined) {
      const clean = sanitizeRichHtml(dto.answerHtml);
      data.answerHtml = clean;
      data.answerText = stripHtml(clean);
    }
    if (dto.slug !== undefined) data.slug = await this.uniqueSlug(dto.slug.trim() || slugify(''), id);
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.locale !== undefined) data.locale = dto.locale;
    if (dto.visibility !== undefined) data.visibility = dto.visibility;
    if (dto.tags !== undefined) data.tags = dto.tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    return this.prisma.kbArticle.update({ where: { id }, data });
  }

  async setStatus(id: string, status: ContentStatus) {
    await this.adminGet(id);
    return this.prisma.kbArticle.update({
      where: { id },
      data: { status, publishedAt: status === ContentStatus.published ? new Date() : null },
    });
  }

  async remove(id: string) {
    await this.adminGet(id);
    await this.prisma.kbArticle.delete({ where: { id } });
    return { deleted: true };
  }

  /** Garantiza un slug único (agrega sufijo -2, -3… ante colisión). */
  private async uniqueSlug(base: string, excludeId?: string): Promise<string> {
    const root = base || 'articulo';
    let candidate = root;
    for (let n = 2; n < 1000; n++) {
      const clash = await this.prisma.kbArticle.findFirst({
        where: { slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) },
        select: { id: true },
      });
      if (!clash) return candidate;
      candidate = `${root}-${n}`;
    }
    throw new BadRequestException('No se pudo generar un slug único');
  }
}
