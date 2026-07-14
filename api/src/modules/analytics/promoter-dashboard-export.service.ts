import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import ExcelJS from 'exceljs';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  PromoterDashboardDto,
  PromoterDimensionRowDto,
} from './dto/promoter-dashboard.dto';
import { PromoterDashboardService } from './promoter-dashboard.service';

Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN });

const MONEY_FMT = '#,##0.00';

export interface DashboardExport {
  filename: string;
  buffer: Buffer;
}

/** Etiqueta legible por dimensión (para el título de cada hoja). */
const SHEET_TITLE: Record<string, string> = {
  event: 'Por evento',
  category: 'Por categoría',
  hall: 'Por salón',
  status: 'Por estado',
  month: 'Por mes',
};

/** Estado de evento → etiqueta ES (la dimensión `status` usa la clave cruda). */
const STATUS_LABEL: Record<string, string> = {
  draft: 'Borrador',
  published: 'Publicado',
  suspended: 'Suspendido',
  cancelled: 'Cancelado',
  finished: 'Finalizado',
};

/**
 * Exporta a Excel (.xlsx) el dashboard GLOBAL del promotor (Fase 3): una hoja
 * "Resumen" con los KPIs de rentabilidad y una hoja por cada dimensión (Evento /
 * Categoría / Salón / Estado / Mes) con la tabla cruzada dimensión × métricas.
 *
 * Reusa `PromoterDashboardService` (misma agregación server-authoritative del
 * snapshot inmutable) → coherente con la liquidación (W7). Nunca `number` para
 * dinero (decimal.js). La authz la aplica el service subyacente.
 */
@Injectable()
export class PromoterDashboardExportService {
  constructor(private readonly dashboard: PromoterDashboardService) {}

  async exportForPromoter(user: AuthUser, promoterId?: string): Promise<DashboardExport> {
    const data = await this.dashboard.forPromoter(user, promoterId);
    const buffer = await this.buildWorkbook(data);
    return { filename: `dashboard-${this.slug(data.promoterName)}.xlsx`, buffer };
  }

  private slug(v: string): string {
    return (
      v
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'promotor'
    );
  }

  private num(v: Decimal.Value | null | undefined): number {
    return new Decimal(v ?? 0).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toNumber();
  }

  private async buildWorkbook(d: PromoterDashboardDto): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Boletiva';
    wb.created = new Date();

    // --- Hoja Resumen (KPIs globales) ---
    const resumen = wb.addWorksheet('Resumen');
    resumen.columns = [
      { header: 'Concepto', key: 'k', width: 44 },
      { header: 'Valor', key: 'v', width: 20 },
    ];
    resumen.getRow(1).font = { bold: true };
    const s = d.summary;
    const rows: Array<[string, number | string, boolean]> = [
      ['Promotor', d.promoterName, false],
      ['Eventos', d.eventsCount, false],
      ['Eventos publicados', d.publishedCount, false],
      ['Órdenes pagadas', s.paidOrders, false],
      ['Boletos vendidos', s.ticketsSold, false],
      ['Recaudado (bruto)', this.num(s.gross), true],
      ['Cuota por servicio (sin IVA)', this.num(s.services), true],
      ['  · Comisión de plataforma', this.num(s.platformFee), true],
      ['  · Comisión de pasarela', this.num(s.gatewayFee), true],
      ['  · Cargos fijos', this.num(s.fixedFees), true],
      ['IVA', this.num(s.iva), true],
      ['Devoluciones (órdenes)', s.refundsCount, false],
      ['Devoluciones (neto devuelto)', this.num(s.refundsIssued), true],
      ['Aforo total', s.capacity, false],
      ['Check-ins', s.checkedIn, false],
      ['Ocupación %', s.occupancyPct, false],
      ['Neto del promotor', this.num(s.net), true],
    ];
    for (const [k, v, money] of rows) {
      const row = resumen.addRow({ k, v });
      if (money) row.getCell('v').numFmt = MONEY_FMT;
    }
    resumen.getRow(resumen.rowCount).font = { bold: true };

    // --- Una hoja por dimensión ---
    for (const dim of ['event', 'category', 'hall', 'status', 'month'] as const) {
      const rowsDim =
        dim === 'status' ? this.localizeStatus(d.dimensions[dim]) : d.dimensions[dim];
      this.addDimensionSheet(wb, SHEET_TITLE[dim], rowsDim);
    }

    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out);
  }

  /** Traduce la clave de estado a etiqueta ES en la columna del reporte. */
  private localizeStatus(rows: PromoterDimensionRowDto[]): PromoterDimensionRowDto[] {
    return rows.map((r) => ({ ...r, label: STATUS_LABEL[r.label] ?? r.label }));
  }

  private addDimensionSheet(
    wb: ExcelJS.Workbook,
    title: string,
    rows: PromoterDimensionRowDto[],
  ): void {
    const ws = wb.addWorksheet(title);
    ws.columns = [
      { header: 'Grupo', key: 'label', width: 30 },
      { header: 'Eventos', key: 'events', width: 10 },
      { header: 'Boletos', key: 'sold', width: 10 },
      { header: 'Recaudado', key: 'gross', width: 15 },
      { header: 'Neto', key: 'net', width: 15 },
      { header: 'Servicios', key: 'services', width: 15 },
      { header: 'IVA', key: 'iva', width: 13 },
      { header: 'Devoluciones', key: 'refunds', width: 15 },
      { header: 'Aforo', key: 'capacity', width: 10 },
      { header: 'Check-ins', key: 'checkedIn', width: 11 },
      { header: 'Ocupación %', key: 'occ', width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of rows) {
      const row = ws.addRow({
        label: r.label,
        events: r.events,
        sold: r.ticketsSold,
        gross: this.num(r.gross),
        net: this.num(r.net),
        services: this.num(r.services),
        iva: this.num(r.iva),
        refunds: this.num(r.refunds),
        capacity: r.capacity,
        checkedIn: r.checkedIn,
        occ: r.occupancyPct,
      });
      for (const c of ['gross', 'net', 'services', 'iva', 'refunds']) {
        row.getCell(c).numFmt = MONEY_FMT;
      }
    }
  }
}
