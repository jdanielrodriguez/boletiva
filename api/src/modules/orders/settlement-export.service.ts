import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import Decimal from 'decimal.js';
import ExcelJS from 'exceljs';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { SettlementService } from './settlement.service';

Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN });

/** Formato de moneda GTQ para las celdas numéricas del Excel. */
const MONEY_FMT = '#,##0.00';

/** Resultado de la exportación: nombre de archivo + buffer del .xlsx. */
export interface SettlementExport {
  filename: string;
  buffer: Buffer;
}

/**
 * Exporta a Excel (.xlsx) el DETALLE COMPLETO de la liquidación de un evento (W7):
 * una hoja "Resumen" con los totales (recaudado, servicios, IVA, neto del promotor
 * = total transferido) y una hoja "Boletos" con cada boleto vendido y su desglose
 * server-authoritative (neto, comisión de plataforma, comisión de pasarela, IVA).
 *
 * Reusa la contabilidad existente: los totales salen de `SettlementService`
 * (snapshot inmutable de las órdenes pagadas) y el desglose por boleto del
 * `quote` inmutable de cada `order_item`. Nunca `number` para dinero (decimal.js).
 *
 * Authz: admin o el promotor DUEÑO del evento (evento inexistente → 404; ajeno →
 * 403). Elegibilidad: el evento debe estar finalizado/suspendido, o su fecha ya
 * haber pasado, o tener al menos una orden pagada (si no, no hay nada que liquidar
 * → 409).
 */
@Injectable()
export class SettlementExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settlement: SettlementService,
  ) {}

  async exportForEvent(eventId: string, user: AuthUser): Promise<SettlementExport> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, name: true, slug: true, promoterId: true, status: true, endsAt: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');

    const isAdmin = user.roles.includes(Role.admin);
    const isOwner = event.promoterId === user.userId;
    if (!isAdmin && !isOwner) throw new ForbiddenException('No es tu evento');

    // Elegibilidad: finalizado/suspendido, fecha pasada, o con ventas pagadas.
    const paidOrders = await this.prisma.order.count({
      where: { eventId: event.id, status: 'paid' },
    });
    const eligible =
      event.status === 'finished' ||
      event.status === 'suspended' ||
      event.endsAt.getTime() < Date.now() ||
      paidOrders > 0;
    if (!eligible) {
      throw new ConflictException(
        'El evento aún no es liquidable: debe estar finalizado/suspendido, haber pasado su fecha, o tener ventas pagadas',
      );
    }

    // Totales agregados (reusa la contabilidad del settlement).
    const summary = await this.settlement.summaryForEvent(event.id, event.name);

    // Detalle por boleto: ítems activos de órdenes pagadas (un boleto por línea).
    const items = await this.prisma.orderItem.findMany({
      where: { order: { eventId: event.id, status: 'paid' }, active: true },
      orderBy: { createdAt: 'asc' },
      include: {
        locality: { select: { name: true } },
        order: {
          select: { buyer: { select: { firstName: true, lastName: true, email: true } } },
        },
      },
    });

    const buffer = await this.buildWorkbook(event.name, summary, items);
    return { filename: `liquidacion-${this.slug(event.slug || event.name)}.xlsx`, buffer };
  }

  /** Slug seguro para el nombre de archivo (ASCII, sin espacios). */
  private slug(v: string): string {
    return (
      v
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'evento'
    );
  }

  private num(v: Decimal.Value | null | undefined): number {
    return new Decimal(v ?? 0).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toNumber();
  }

  private async buildWorkbook(
    eventName: string,
    summary: Awaited<ReturnType<SettlementService['summaryForEvent']>>,
    items: Array<{
      label: string | null;
      net: Decimal;
      total: Decimal;
      quote: unknown;
      locality: { name: string } | null;
      order: {
        buyer: { firstName: string | null; lastName: string | null; email: string | null } | null;
      } | null;
    }>,
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Boletiva';
    wb.created = new Date();

    // --- Hoja Resumen ---
    const resumen = wb.addWorksheet('Resumen');
    resumen.columns = [
      { header: 'Concepto', key: 'k', width: 42 },
      { header: 'Monto (GTQ)', key: 'v', width: 18 },
    ];
    resumen.getRow(1).font = { bold: true };
    const rows: Array<[string, number | string]> = [
      ['Evento', eventName],
      ['Órdenes pagadas', summary.paidOrders],
      ['Boletos vendidos', summary.ticketsSold],
      ['Recaudado (bruto)', this.num(summary.gross)],
      ['Cuota por servicio (plataforma + pasarela + fijos)', this.num(summary.serviceFee)],
      ['  · Comisión de plataforma', this.num(summary.platformFee)],
      ['  · Comisión de pasarela', this.num(summary.gatewayFee)],
      ['  · Cargos fijos', this.num(summary.fixedFees)],
      ['IVA', this.num(summary.iva)],
      ['Servicios totales (no van al promotor)', this.num(summary.services)],
      ['Neto del promotor = total transferido', this.num(summary.net)],
    ];
    for (const [k, v] of rows) {
      const row = resumen.addRow({ k, v });
      if (typeof v === 'number' && k !== 'Órdenes pagadas' && k !== 'Boletos vendidos') {
        row.getCell('v').numFmt = MONEY_FMT;
      }
    }
    // Resaltar el neto del promotor (última fila).
    resumen.getRow(resumen.rowCount).font = { bold: true };

    // --- Hoja Boletos ---
    const boletos = wb.addWorksheet('Boletos');
    boletos.columns = [
      { header: '#', key: 'i', width: 6 },
      { header: 'Comprador', key: 'buyer', width: 26 },
      { header: 'Correo', key: 'email', width: 28 },
      { header: 'Localidad', key: 'loc', width: 18 },
      { header: 'Asiento', key: 'seat', width: 14 },
      { header: 'Precio pagado', key: 'total', width: 15 },
      { header: 'Neto promotor', key: 'net', width: 15 },
      { header: 'Comisión plataforma', key: 'platform', width: 18 },
      { header: 'Comisión pasarela', key: 'gateway', width: 18 },
      { header: 'IVA', key: 'iva', width: 12 },
    ];
    boletos.getRow(1).font = { bold: true };

    items.forEach((it, idx) => {
      const q = (it.quote ?? {}) as Record<string, unknown>;
      const buyer = it.order?.buyer;
      const buyerName =
        [buyer?.firstName, buyer?.lastName].filter(Boolean).join(' ').trim() || null;
      const row = boletos.addRow({
        i: idx + 1,
        buyer: buyerName ?? '(anónimo)',
        email: buyer?.email ?? '',
        loc: it.locality?.name ?? '',
        seat: it.label ?? 'General',
        total: this.num(it.total),
        net: this.num(it.net),
        platform: this.num(q.platformFee as Decimal.Value),
        gateway: this.num(q.gatewayFee as Decimal.Value),
        iva: this.num(q.iva as Decimal.Value),
      });
      for (const c of ['total', 'net', 'platform', 'gateway', 'iva']) {
        row.getCell(c).numFmt = MONEY_FMT;
      }
    });

    // Fila de totales de la hoja Boletos (cuadra con el Resumen).
    const totalRow = boletos.addRow({
      buyer: 'TOTAL',
      total: this.num(summary.gross),
      net: this.num(summary.net),
      platform: this.num(summary.platformFee),
      gateway: this.num(summary.gatewayFee),
      iva: this.num(summary.iva),
    });
    totalRow.font = { bold: true };
    for (const c of ['total', 'net', 'platform', 'gateway', 'iva']) {
      totalRow.getCell(c).numFmt = MONEY_FMT;
    }

    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out);
  }
}
