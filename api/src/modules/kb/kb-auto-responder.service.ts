import { Injectable } from '@nestjs/common';
import { ContentStatus, KbVisibility, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface KbSuggestion {
  slug: string;
  question: string;
  answerText: string;
  score: number;
}

interface SuggestOpts {
  locale?: string;
  limit?: number;
  /** Incluir artículos INTERNOS (para el asistente del agente/bot; NO para el FAQ público). */
  includeInternal?: boolean;
}

const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'y', 'o', 'que', 'como', 'cómo',
  'para', 'por', 'en', 'con', 'mi', 'me', 'se', 'es', 'a', 'the', 'to', 'of', 'is', 'my',
  'how', 'do', 'i', 'can', 'and', 'or', 'for', 'in', 'with',
]);

/**
 * Autoresponder del KB (T6): dado el texto de un usuario, devuelve los artículos más
 * relevantes para que el chat/bot sugiera una respuesta. Hoy usa un ranking LÉXICO
 * (solapamiento de términos: pregunta > etiquetas > respuesta); la interfaz `suggest()`
 * está lista para sustituirse por RAG (embeddings + Gemini) SIN cambiar los llamadores:
 * un futuro `EmbeddingKbRetriever` implementaría la misma forma. Server-authoritative.
 */
@Injectable()
export class KbAutoResponderService {
  constructor(private readonly prisma: PrismaService) {}

  private tokenize(text: string): string[] {
    return text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  }

  /** Devuelve hasta `limit` artículos relevantes al `query`, ordenados por score desc. */
  async suggest(query: string, opts: SuggestOpts = {}): Promise<KbSuggestion[]> {
    const limit = Math.min(Math.max(opts.limit ?? 5, 1), 10);
    const terms = [...new Set(this.tokenize(query))];
    if (!terms.length) return [];

    const where: Prisma.KbArticleWhereInput = {
      status: ContentStatus.published,
      ...(opts.includeInternal ? {} : { visibility: KbVisibility.public }),
      ...(opts.locale ? { locale: opts.locale } : {}),
    };
    // Prefiltra por cualquier término (barato) y rankea en memoria (los KB son pocos).
    where.OR = terms.flatMap((t) => [
      { question: { contains: t, mode: 'insensitive' as const } },
      { answerText: { contains: t, mode: 'insensitive' as const } },
      { tags: { has: t } },
    ]);

    const candidates = await this.prisma.kbArticle.findMany({
      where,
      select: { slug: true, question: true, answerText: true, tags: true },
      take: 50,
    });

    const scored = candidates
      .map((c) => {
        const qTokens = new Set(this.tokenize(c.question));
        const aTokens = new Set(this.tokenize(c.answerText));
        const tagSet = new Set(c.tags.map((t) => t.toLowerCase()));
        let hits = 0;
        let weight = 0;
        for (const t of terms) {
          if (qTokens.has(t)) { hits++; weight += 3; }      // match en la pregunta = fuerte
          else if (tagSet.has(t)) { hits++; weight += 2; }  // etiqueta
          else if (aTokens.has(t)) { hits++; weight += 1; } // en la respuesta
        }
        // score normalizado 0..1: cobertura de términos ponderada.
        const score = hits === 0 ? 0 : weight / (terms.length * 3);
        return { slug: c.slug, question: c.question, answerText: c.answerText, score: Number(score.toFixed(4)) };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  }
}
