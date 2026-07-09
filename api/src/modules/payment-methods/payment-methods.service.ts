import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SavedCard } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CARD_TOKENIZER, CardTokenizer } from './card-tokenizer';
import { AddPaymentMethodDto } from './dto/payment-methods.dto';

/**
 * Métodos de pago del usuario (tarjetas tokenizadas, PCI-DSS). El PAN nunca toca
 * el backend: recibimos un `nonce` del SDK de la pasarela, lo intercambiamos por un
 * token opaco (puerto CardTokenizer) y guardamos solo token + marca + últimos 4.
 */
@Injectable()
export class PaymentMethodsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CARD_TOKENIZER) private readonly tokenizer: CardTokenizer,
  ) {}

  /** Vista segura (sin token ni PAN). */
  private sanitize(c: SavedCard) {
    return {
      id: c.id,
      brand: c.brand,
      last4: c.last4,
      isDefault: c.isDefault,
      createdAt: c.createdAt.toISOString(),
    };
  }

  /** Lista los métodos del usuario (el default primero, luego más recientes). */
  async list(userId: string) {
    const cards = await this.prisma.savedCard.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return cards.map((c) => this.sanitize(c));
  }

  /**
   * Añade una tarjeta. Tokeniza el nonce (nunca el PAN). Se marca por defecto si el
   * usuario lo pide o si es su primera tarjeta (siempre debe haber un default).
   */
  async add(userId: string, dto: AddPaymentMethodDto) {
    const { token } = await this.tokenizer.tokenize(dto.nonce);
    const count = await this.prisma.savedCard.count({ where: { userId } });
    const makeDefault = dto.isDefault === true || count === 0;

    const created = await this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.savedCard.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      }
      return tx.savedCard.create({
        data: { userId, brand: dto.brand, last4: dto.last4, token, isDefault: makeDefault },
      });
    });
    return this.sanitize(created);
  }

  /** Marca una tarjeta propia como default (desmarca las demás). IDOR→404. */
  async setDefault(userId: string, id: string) {
    const card = await this.prisma.savedCard.findFirst({ where: { id, userId } });
    if (!card) throw new NotFoundException('Método de pago no encontrado');
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.savedCard.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      return tx.savedCard.update({ where: { id }, data: { isDefault: true } });
    });
    return this.sanitize(updated);
  }

  /**
   * Elimina una tarjeta propia. IDOR→404. Si era la default y quedan otras, promueve
   * la más reciente a default (siempre hay un default si hay tarjetas).
   */
  async remove(userId: string, id: string) {
    const card = await this.prisma.savedCard.findFirst({ where: { id, userId } });
    if (!card) throw new NotFoundException('Método de pago no encontrado');
    await this.prisma.$transaction(async (tx) => {
      await tx.savedCard.delete({ where: { id } });
      if (card.isDefault) {
        const next = await tx.savedCard.findFirst({
          where: { userId },
          orderBy: { createdAt: 'desc' },
        });
        if (next) {
          await tx.savedCard.update({ where: { id: next.id }, data: { isDefault: true } });
        }
      }
    });
    return { deleted: true };
  }
}
