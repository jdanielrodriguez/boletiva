import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GatewayStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface CreateGatewayInput {
  name: string;
  provider: string;
  feePct: number;
  credentialsRef?: string;
  sandbox?: boolean;
}

export interface UpdateGatewayInput {
  name?: string;
  feePct?: number;
  credentialsRef?: string;
  sandbox?: boolean;
}

/**
 * Administración de pasarelas de pago configurables. La comisión de cada pasarela
 * alimenta el gross-up del precio (Ticket C). Solo una pasarela es la default de
 * plataforma; solo pasarelas `active` se ofrecen para cobrar.
 */
@Injectable()
export class PaymentGatewaysService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.paymentGateway.findMany({ orderBy: { createdAt: 'asc' } });
  }

  /** Pasarelas disponibles para cobrar (activas). */
  listActive() {
    return this.prisma.paymentGateway.findMany({
      where: { status: GatewayStatus.active },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Pasarela default de plataforma (fallback general). */
  platformDefault() {
    return this.prisma.paymentGateway.findFirst({ where: { isPlatformDefault: true } });
  }

  async get(id: string) {
    const gw = await this.prisma.paymentGateway.findUnique({ where: { id } });
    if (!gw) throw new NotFoundException('Pasarela no encontrada');
    return gw;
  }

  async create(input: CreateGatewayInput) {
    this.assertPct(input.feePct);
    try {
      return await this.prisma.paymentGateway.create({
        data: {
          name: input.name,
          provider: input.provider,
          feePct: new Prisma.Decimal(input.feePct),
          credentialsRef: input.credentialsRef,
          sandbox: input.sandbox ?? false,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya existe una pasarela con ese nombre');
      }
      throw e;
    }
  }

  async update(id: string, input: UpdateGatewayInput) {
    if (input.feePct !== undefined) this.assertPct(input.feePct);
    await this.get(id);
    try {
      return await this.prisma.paymentGateway.update({
        where: { id },
        data: {
          name: input.name,
          feePct: input.feePct !== undefined ? new Prisma.Decimal(input.feePct) : undefined,
          credentialsRef: input.credentialsRef,
          sandbox: input.sandbox,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya existe una pasarela con ese nombre');
      }
      throw e;
    }
  }

  /**
   * Cambia el estado. No se puede desactivar/mantener la default de plataforma
   * (primero hay que designar otra default). La guarda de "en uso por eventos"
   * se refuerza en el Ticket B (asociación evento↔pasarela).
   */
  async setStatus(id: string, status: GatewayStatus) {
    const gw = await this.get(id);
    if (gw.isPlatformDefault && status !== GatewayStatus.active) {
      throw new ConflictException(
        'No se puede desactivar la pasarela default de plataforma; designa otra primero',
      );
    }
    return this.prisma.paymentGateway.update({ where: { id }, data: { status } });
  }

  /** Designa la pasarela default de plataforma (debe estar activa). Atómico. */
  async makeDefault(id: string) {
    const gw = await this.get(id);
    if (gw.status !== GatewayStatus.active) {
      throw new ConflictException('Solo una pasarela activa puede ser la default');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.paymentGateway.updateMany({
        where: { isPlatformDefault: true },
        data: { isPlatformDefault: false },
      });
      return tx.paymentGateway.update({ where: { id }, data: { isPlatformDefault: true } });
    });
  }

  private assertPct(v: number): void {
    if (!Number.isFinite(v) || v < 0 || v >= 1) {
      throw new BadRequestException('feePct debe estar en el rango [0, 1)');
    }
  }
}
