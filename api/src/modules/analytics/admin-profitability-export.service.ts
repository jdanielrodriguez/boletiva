import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import ExcelJS from 'exceljs';
import { AdminProfitabilityService } from './admin-profitability.service';

Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN });

const MONEY_FMT = '#,##0.00';

export interface ProfitabilityExport {
  filename: string;
  buffer: Buffer;
}

/** Exporta a Excel (.xlsx) la rentabilidad por evento (admin, Fase 4). Reusa el service. */
@Injectable()
export class AdminProfitabilityExportService {
  constructor(private readonly profitability: AdminProfitabilityService) {}

  async export(): Promise<ProfitabilityExport> {
    const data = await this.profitability.overview();
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Boletiva';
    wb.created = new Date();

    const ws = wb.addWorksheet('Rentabilidad por evento');
    ws.columns = [
      { header: 'Evento', key: 'name', width: 30 },
      { header: 'Promotor', key: 'promoter', width: 24 },
      { header: 'Estado', key: 'status', width: 12 },
      { header: 'Boletos', key: 'sold', width: 10 },
      { header: 'Recaudado', key: 'gross', width: 15 },
      { header: 'Neto promotor', key: 'net', width: 15 },
      { header: 'Ganancia plataforma', key: 'platform', width: 18 },
      { header: '% plataforma', key: 'pct', width: 12 },
      { header: 'Pasarela', key: 'gateway', width: 14 },
      { header: 'IVA', key: 'iva', width: 13 },
    ];
    ws.getRow(1).font = { bold: true };
    const num = (v: string): number => new Decimal(v).toNumber();
    for (const r of data.events) {
      const row = ws.addRow({
        name: r.name,
        promoter: r.promoterName,
        status: r.status,
        sold: r.ticketsSold,
        gross: num(r.gross),
        net: num(r.net),
        platform: num(r.platformFee),
        pct: r.platformPct,
        gateway: num(r.gatewayFee),
        iva: num(r.iva),
      });
      for (const c of ['gross', 'net', 'platform', 'gateway', 'iva']) row.getCell(c).numFmt = MONEY_FMT;
    }
    const totalRow = ws.addRow({
      name: 'TOTAL',
      sold: data.ticketsSold,
      gross: num(data.gross),
      net: num(data.net),
      platform: num(data.platformFee),
      pct: data.platformPct,
      gateway: num(data.gatewayFee),
      iva: num(data.iva),
    });
    totalRow.font = { bold: true };
    for (const c of ['gross', 'net', 'platform', 'gateway', 'iva']) totalRow.getCell(c).numFmt = MONEY_FMT;

    const out = await wb.xlsx.writeBuffer();
    return { filename: 'rentabilidad-eventos.xlsx', buffer: Buffer.from(out) };
  }
}
