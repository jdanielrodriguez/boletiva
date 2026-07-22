import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SupportCategory } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

interface MacroInput {
  title: string;
  body: string;
  lang?: string;
  category?: SupportCategory | null;
}

/**
 * Respuestas rápidas / macros de soporte (T2). Textos reutilizables que el agente
 * inserta al responder, por idioma (es/en) y categoría opcional. CRUD de agente/admin;
 * el filtrado por idioma/categoría permite ofrecer la macro correcta según el ticket.
 */
@Injectable()
export class SupportMacrosService {
  constructor(private readonly prisma: PrismaService) {}

  async list(lang?: string, category?: SupportCategory) {
    const where: Prisma.SupportCannedResponseWhereInput = {};
    if (lang) where.lang = lang;
    if (category) where.category = category;
    return this.prisma.supportCannedResponse.findMany({ where, orderBy: { title: 'asc' } });
  }

  async create(input: MacroInput, actorId: string) {
    return this.prisma.supportCannedResponse.create({
      data: {
        title: input.title.trim(),
        body: input.body.trim(),
        lang: input.lang ?? 'es',
        category: input.category ?? null,
        createdById: actorId,
      },
    });
  }

  async update(id: string, patch: Partial<MacroInput>) {
    await this.getOr404(id);
    const data: Prisma.SupportCannedResponseUpdateInput = {};
    if (patch.title !== undefined) data.title = patch.title.trim();
    if (patch.body !== undefined) data.body = patch.body.trim();
    if (patch.lang !== undefined) data.lang = patch.lang;
    if (patch.category !== undefined) data.category = patch.category;
    return this.prisma.supportCannedResponse.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.getOr404(id);
    await this.prisma.supportCannedResponse.delete({ where: { id } });
    return { deleted: true };
  }

  private async getOr404(id: string) {
    const m = await this.prisma.supportCannedResponse.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('Respuesta rápida no encontrada');
    return m;
  }
}
