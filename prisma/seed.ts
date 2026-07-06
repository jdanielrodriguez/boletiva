import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Seed base (Ola 0): configuración por defecto del sistema que administra el
 * admin. Estos valores alimentan el motor de precios de la Ola 2.
 */
async function main(): Promise<void> {
  const defaults: Array<{ key: string; value: unknown; description: string }> = [
    { key: 'pricing.platform_fee_pct', value: 0.1, description: 'Comisión de plataforma sobre el neto del promotor (0.10 = 10%)' },
    { key: 'pricing.gateway_fee_pct', value: 0.05, description: 'Comisión de la pasarela sobre el total cobrado (0.05 = 5%)' },
    { key: 'pricing.iva_pct', value: 0.12, description: 'IVA Guatemala sobre la base gravable (neto + comisión plataforma)' },
    { key: 'wallet.withdraw_fee_promoter_pct', value: 0.03, description: 'Comisión de retiro de saldo interno para promotores' },
    { key: 'wallet.withdraw_fee_user_pct', value: 0.06, description: 'Comisión de retiro para usuarios (el doble que promotor)' },
    { key: 'transfer.max_per_ticket_default', value: 1, description: 'Máximo de transferencias por boleto por defecto (el promotor puede subirlo)' },
  ];

  for (const s of defaults) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { description: s.description },
      create: { key: s.key, value: s.value as object, description: s.description },
    });
  }

  const count = await prisma.setting.count();
  console.log(`Seed completado. Settings en BD: ${count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
