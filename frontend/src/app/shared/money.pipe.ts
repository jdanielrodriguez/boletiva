import { Pipe, PipeTransform } from '@angular/core';

/**
 * Formatea montos a moneda de Guatemala con SIEMPRE 2 decimales y separador de
 * miles: `Q150.00`, `Q1,234.56`, `Q19.80`. Acepta el Decimal-como-string del
 * backend o un number. Valores nulos/no numéricos → `Q0.00` (nunca "QNaN").
 *
 * Regla del proyecto: la moneda se muestra uniforme en TODA la app (checkout,
 * resumen, wallet, facturación, boletos) — usar este pipe, no interpolar crudo.
 */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  private static readonly fmt = new Intl.NumberFormat('es-GT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  transform(value: string | number | null | undefined): string {
    const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
    return `Q${MoneyPipe.fmt.format(Number.isFinite(n) ? n : 0)}`;
  }
}
