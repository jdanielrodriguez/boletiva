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
  transactionFixedFee?: number;
  minCostSharePct?: number;
  installmentRates?: Record<string, number>;
  installmentFixedFee?: number;
  installmentsEnabled?: boolean;
  credentialsRef?: string;
  sandbox?: boolean;
}

export interface UpdateGatewayInput {
  name?: string;
  feePct?: number;
  transactionFixedFee?: number;
  minCostSharePct?: number;
  installmentRates?: Record<string, number>;
  installmentFixedFee?: number;
  installmentsEnabled?: boolean;
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

  /** Pasarelas disponibles para cobrar (activas). Uso INTERNO (incluye credentialsRef). */
  listActive() {
    return this.prisma.paymentGateway.findMany({
      where: { status: GatewayStatus.active },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Pasarelas activas para exponer a promotores (elección de método de su evento):
   * OMITE `credentialsRef` (referencia al secreto) — QA: no debe salir de admin.
   */
  listActivePublic() {
    return this.prisma.paymentGateway.findMany({
      where: { status: GatewayStatus.active },
      orderBy: { createdAt: 'asc' },
      omit: { credentialsRef: true },
    });
  }

  /** Pasarela default de plataforma (fallback general). */
  platformDefault() {
    return this.prisma.paymentGateway.findFirst({ where: { isPlatformDefault: true } });
  }

  /**
   * Pasarela SANDBOX activa (simulador) a la que se anclan los usuarios de prueba
   * (isTestUser) para no contaminar métricas de pasarelas reales. Prefiere la
   * default si además es sandbox.
   */
  sandboxGateway() {
    return this.prisma.paymentGateway.findFirst({
      where: { sandbox: true, status: GatewayStatus.active },
      orderBy: { isPlatformDefault: 'desc' },
    });
  }

  async get(id: string) {
    const gw = await this.prisma.paymentGateway.findUnique({ where: { id } });
    if (!gw) throw new NotFoundException('Pasarela no encontrada');
    return gw;
  }

  async create(input: CreateGatewayInput) {
    this.assertPct(input.feePct);
    if (input.transactionFixedFee !== undefined) this.assertFixed(input.transactionFixedFee);
    if (input.minCostSharePct !== undefined) this.assertSharePct(input.minCostSharePct);
    if (input.installmentRates !== undefined) this.assertInstallmentRates(input.installmentRates);
    try {
      return await this.prisma.paymentGateway.create({
        data: {
          name: input.name,
          provider: input.provider,
          feePct: new Prisma.Decimal(input.feePct),
          transactionFixedFee:
            input.transactionFixedFee !== undefined
              ? new Prisma.Decimal(input.transactionFixedFee)
              : undefined,
          minCostSharePct:
            input.minCostSharePct !== undefined
              ? new Prisma.Decimal(input.minCostSharePct)
              : undefined,
          installmentRates: (input.installmentRates ?? undefined) as Prisma.InputJsonValue | undefined,
          installmentFixedFee:
            input.installmentFixedFee !== undefined
              ? new Prisma.Decimal(input.installmentFixedFee)
              : undefined,
          installmentsEnabled: input.installmentsEnabled ?? undefined,
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
    if (input.transactionFixedFee !== undefined) this.assertFixed(input.transactionFixedFee);
    if (input.minCostSharePct !== undefined) this.assertSharePct(input.minCostSharePct);
    if (input.installmentRates !== undefined) this.assertInstallmentRates(input.installmentRates);
    const current = await this.get(id);
    // Edge 5: la pasarela default del sistema NO puede exigir cost-share (siempre
    // debe ser vendible para cualquier promotor → evita dejar un evento sin método).
    if (current.isPlatformDefault && input.minCostSharePct !== undefined && input.minCostSharePct > 0) {
      throw new ConflictException(
        'La pasarela default de plataforma no puede exigir colaboración mínima (debe estar disponible para todos)',
      );
    }
    try {
      return await this.prisma.paymentGateway.update({
        where: { id },
        data: {
          name: input.name,
          feePct: input.feePct !== undefined ? new Prisma.Decimal(input.feePct) : undefined,
          transactionFixedFee:
            input.transactionFixedFee !== undefined
              ? new Prisma.Decimal(input.transactionFixedFee)
              : undefined,
          minCostSharePct:
            input.minCostSharePct !== undefined
              ? new Prisma.Decimal(input.minCostSharePct)
              : undefined,
          installmentRates:
            input.installmentRates !== undefined
              ? (input.installmentRates as Prisma.InputJsonValue)
              : undefined,
          installmentFixedFee:
            input.installmentFixedFee !== undefined
              ? new Prisma.Decimal(input.installmentFixedFee)
              : undefined,
          installmentsEnabled: input.installmentsEnabled,
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
    // Edge 5: la default no puede exigir colaboración mínima (dejaría a algunos
    // promotores sin ninguna pasarela). Debe bajarse su umbral a 0 primero.
    if (gw.minCostSharePct.gt(0)) {
      throw new ConflictException(
        'La pasarela exige colaboración mínima; ponla en 0 antes de hacerla default',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.paymentGateway.updateMany({
        where: { isPlatformDefault: true },
        data: { isPlatformDefault: false },
      });
      return tx.paymentGateway.update({ where: { id }, data: { isPlatformDefault: true } });
    });
  }

  /**
   * Elimina una pasarela y MIGRA a la default de plataforma los eventos que la
   * referencian (elegida o congelada). No se puede eliminar la default (designa
   * otra primero). Los pedidos ya cobrados conservan su snapshot; solo cambian
   * las cotizaciones futuras de esos eventos.
   */
  async remove(id: string) {
    const gw = await this.get(id);
    if (gw.isPlatformDefault) {
      throw new ConflictException('No se puede eliminar la pasarela default; designa otra primero');
    }
    // Regla v3.7: solo se elimina una pasarela INACTIVA. En mantenimiento o activa
    // → 409 (primero hay que desactivarla; puede tener eventos/compras en curso).
    if (gw.status !== GatewayStatus.inactive) {
      throw new ConflictException(
        'Solo se puede eliminar una pasarela inactiva; desactívala primero',
      );
    }
    const fallback = await this.platformDefault();
    if (!fallback) {
      throw new ConflictException('No hay pasarela default para migrar los eventos');
    }
    await this.prisma.$transaction([
      this.prisma.event.updateMany({ where: { gatewayId: id }, data: { gatewayId: fallback.id } }),
      this.prisma.event.updateMany({
        where: { frozenGatewayId: id },
        data: { frozenGatewayId: fallback.id },
      }),
      this.prisma.paymentGateway.delete({ where: { id } }),
    ]);
    return { deleted: id, migratedTo: fallback.id };
  }

  private assertPct(v: number): void {
    if (!Number.isFinite(v) || v < 0 || v >= 1) {
      throw new BadRequestException('feePct debe estar en el rango [0, 1)');
    }
  }

  private assertFixed(v: number): void {
    if (!Number.isFinite(v) || v < 0) {
      throw new BadRequestException('transactionFixedFee no puede ser negativo');
    }
  }

  private assertSharePct(v: number): void {
    if (!Number.isFinite(v) || v < 0 || v > 1) {
      throw new BadRequestException('minCostSharePct debe estar entre 0 y 1');
    }
  }

  /**
   * Valida el mapa de comisiones por cuotas: claves = enteros >= 2, valores =
   * tasas en [0, 1). {} es válido (sin cuotas).
   */
  private assertInstallmentRates(rates: Record<string, number>): void {
    for (const [k, v] of Object.entries(rates)) {
      const count = Number(k);
      if (!Number.isInteger(count) || count < 2) {
        throw new BadRequestException(`Cuota inválida "${k}": debe ser un entero >= 2`);
      }
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v >= 1) {
        throw new BadRequestException(`Tasa inválida para ${k} cuotas: debe estar en [0, 1)`);
      }
    }
  }
}
