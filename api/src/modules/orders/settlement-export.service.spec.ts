import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import Decimal from 'decimal.js';
import ExcelJS from 'exceljs';
import { SettlementExportService } from './settlement-export.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

/**
 * Cobertura de SettlementExportService (W7): authz (404 inexistente / 403 ajeno /
 * owner / admin), elegibilidad (409 sin ventas ni cierre) y la construcción del
 * .xlsx (nombre de archivo, hojas, celdas de resumen y detalle por boleto). El
 * settlement se mockea (su contabilidad ya está cubierta en su propio spec).
 */
describe('SettlementExportService (branches + xlsx, unit)', () => {
  const summary = {
    eventId: 'e1',
    eventName: 'Festival de Prueba',
    currency: 'GTQ',
    paidOrders: 2,
    ticketsSold: 2,
    gross: '259.36',
    net: '200.00',
    platformFee: '20.00',
    gatewayFee: '12.96',
    fixedFees: '0.00',
    serviceFee: '32.96',
    services: '59.36',
    iva: '26.40',
    refundsIssued: '0.00',
  };

  const dec = (v: string) => new Decimal(v);

  const build = () => {
    const prisma = {
      event: { findUnique: jest.fn() },
      order: { count: jest.fn().mockResolvedValue(2) },
      orderItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const settlement = { summaryForEvent: jest.fn().mockResolvedValue(summary) };
    const service = new SettlementExportService(prisma as never, settlement as never);
    return { prisma, settlement, service };
  };

  const owner: AuthUser = { userId: 'promo', email: 'p@x.com', roles: [Role.promoter] };
  const other: AuthUser = { userId: 'otro', email: 'o@x.com', roles: [Role.promoter] };
  const admin: AuthUser = { userId: 'adm', email: 'a@x.com', roles: [Role.admin] };

  const eligibleEvent = {
    id: 'e1',
    name: 'Festival de Prueba',
    slug: 'festival-de-prueba',
    promoterId: 'promo',
    status: 'finished',
    endsAt: new Date('2026-01-01T00:00:00Z'),
  };

  it('evento inexistente → 404', async () => {
    const { prisma, service } = build();
    prisma.event.findUnique.mockResolvedValue(null);
    await expect(service.exportForEvent('nope', admin)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('promotor ajeno (ni dueño ni admin) → 403', async () => {
    const { prisma, service } = build();
    prisma.event.findUnique.mockResolvedValue(eligibleEvent);
    await expect(service.exportForEvent('e1', other)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('evento sin ventas ni cierre (futuro, 0 pagadas) → 409', async () => {
    const { prisma, service } = build();
    prisma.event.findUnique.mockResolvedValue({
      ...eligibleEvent,
      status: 'published',
      endsAt: new Date(Date.now() + 86_400_000),
    });
    prisma.order.count.mockResolvedValue(0);
    await expect(service.exportForEvent('e1', owner)).rejects.toBeInstanceOf(ConflictException);
  });

  it('evento futuro CON ventas pagadas → elegible (genera xlsx)', async () => {
    const { prisma, service } = build();
    prisma.event.findUnique.mockResolvedValue({
      ...eligibleEvent,
      status: 'published',
      endsAt: new Date(Date.now() + 86_400_000),
    });
    prisma.order.count.mockResolvedValue(1);
    const out = await service.exportForEvent('e1', owner);
    expect(out.filename).toBe('liquidacion-festival-de-prueba.xlsx');
  });

  it('el promotor DUEÑO descarga un .xlsx con Resumen + Boletos y celdas correctas', async () => {
    const { prisma, service } = build();
    prisma.event.findUnique.mockResolvedValue(eligibleEvent);
    prisma.orderItem.findMany.mockResolvedValue([
      {
        label: 'A-12',
        net: dec('100.00'),
        total: dec('129.68'),
        quote: { platformFee: '10.00', gatewayFee: '6.48', iva: '13.20' },
        locality: { name: 'VIP' },
        order: { buyer: { firstName: 'Ana', lastName: 'López', email: 'ana@x.com' } },
      },
      {
        label: null,
        net: dec('100.00'),
        total: dec('129.68'),
        quote: { platformFee: '10.00', gatewayFee: '6.48', iva: '13.20' },
        locality: { name: 'General' },
        order: { buyer: { firstName: null, lastName: null, email: null } },
      },
    ]);

    const { filename, buffer } = await service.exportForEvent('e1', owner);
    expect(filename).toBe('liquidacion-festival-de-prueba.xlsx');
    expect(buffer).toBeInstanceOf(Buffer);
    // Cabecera ZIP de un OOXML (.xlsx) — 'PK'.
    expect(buffer.subarray(0, 2).toString()).toBe('PK');

    // Reabrir el workbook y validar contenido.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const resumen = wb.getWorksheet('Resumen');
    const boletos = wb.getWorksheet('Boletos');
    if (!resumen || !boletos) throw new Error('faltan hojas en el xlsx');

    // Neto del promotor en el resumen (última fila de conceptos).
    const netoRow = resumen
      .getColumn('A')
      .values.findIndex((v) => v === 'Neto del promotor = total transferido');
    expect(resumen.getRow(netoRow).getCell('B').value).toBe(200);

    // El reload de exceljs pierde las keys de columna → usamos letras. Orden:
    // A=# B=Comprador C=Correo D=Localidad E=Asiento F=Precio G=Neto H=Plataforma
    // I=Pasarela J=IVA. Fila 2 = Ana / VIP / A-12; fila 3 = anónimo / General.
    expect(boletos.getRow(2).getCell('B').value).toBe('Ana López');
    expect(boletos.getRow(2).getCell('E').value).toBe('A-12');
    expect(boletos.getRow(2).getCell('H').value).toBe(10);
    expect(boletos.getRow(3).getCell('B').value).toBe('(anónimo)');
    expect(boletos.getRow(3).getCell('E').value).toBe('General');
    // Fila TOTAL cuadra con el resumen (gross, columna F).
    const totalRowIdx = boletos.rowCount;
    expect(boletos.getRow(totalRowIdx).getCell('F').value).toBe(259.36);
  });

  it('un admin puede exportar un evento ajeno', async () => {
    const { prisma, service } = build();
    prisma.event.findUnique.mockResolvedValue(eligibleEvent);
    const out = await service.exportForEvent('e1', admin);
    expect(out.buffer).toBeInstanceOf(Buffer);
  });
});
