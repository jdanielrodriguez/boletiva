import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PricingEngine, FeeParams } from './pricing.engine';

const DEFAULT: FeeParams = { platformFeePct: 0.1, gatewayFeePct: 0.05, ivaPct: 0.12 };

describe('PricingEngine', () => {
  describe('ejemplo canónico (N=100, plataforma 10%, pasarela 5%, IVA 12%)', () => {
    const q = PricingEngine.quote(100, DEFAULT);

    it('el precio final all-in es 129.68', () => {
      expect(q.total).toBe('129.68');
    });
    it('desglosa comisión plataforma 10.00, IVA 13.20, pasarela 6.48', () => {
      expect(q.platformFee).toBe('10.00');
      expect(q.iva).toBe('13.20');
      expect(q.gatewayFee).toBe('6.48');
      expect(q.taxableBase).toBe('110.00');
    });
    it('el promotor recibe EXACTAMENTE su neto (100.00)', () => {
      expect(q.net).toBe('100.00');
    });
    it('vista comprador: cuota de servicio fusiona plataforma + pasarela (16.48)', () => {
      expect(q.serviceFee).toBe('16.48'); // 10.00 (plataforma) + 6.48 (pasarela)
      // El comprador ve: precio de boleto + cuota por servicio + IVA = total.
      expect(new Decimal(q.net).plus(q.serviceFee).plus(q.iva).toFixed(2)).toBe(q.total);
    });
    it('la inversión cuadra: neto + plataforma + IVA + pasarela = total', () => {
      const sum = new Decimal(q.net)
        .plus(q.platformFee)
        .plus(q.iva)
        .plus(q.gatewayFee)
        .plus(q.fixedFees);
      expect(sum.toFixed(2)).toBe(q.total);
    });
  });

  describe('invariante de suma y preservación del neto (varios inputs)', () => {
    const cases: Array<[number, FeeParams]> = [
      [100, DEFAULT],
      [75, DEFAULT],
      [33.33, { platformFeePct: 0.08, gatewayFeePct: 0.035, ivaPct: 0.12 }],
      [250.5, { platformFeePct: 0.15, gatewayFeePct: 0.06, ivaPct: 0.12, fixedFees: 5 }],
      [1, { platformFeePct: 0, gatewayFeePct: 0, ivaPct: 0.12 }],
      [999.99, { platformFeePct: 0.1, gatewayFeePct: 0.05, ivaPct: 0, fixedFees: 3.5 }],
    ];
    it.each(cases)('N=%s: componentes suman el total y el neto se preserva', (net, params) => {
      const q = PricingEngine.quote(net, params);
      const sum = new Decimal(q.net)
        .plus(q.platformFee)
        .plus(q.iva)
        .plus(q.gatewayFee)
        .plus(q.fixedFees);
      expect(sum.toFixed(2)).toBe(q.total); // cuadra al centavo
      expect(q.net).toBe(new Decimal(net).toFixed(2)); // el promotor recibe su neto exacto
      // Todos los componentes tienen exactamente 2 decimales.
      for (const v of [q.net, q.platformFee, q.iva, q.gatewayFee, q.total, q.fixedFees]) {
        expect(v).toMatch(/^\d+\.\d{2}$/);
      }
    });
  });

  describe('precisión (no usar float nativo)', () => {
    it('no arrastra error de coma flotante', () => {
      const q = PricingEngine.quote('0.30', {
        platformFeePct: 0.1,
        gatewayFeePct: 0.05,
        ivaPct: 0.12,
      });
      // 0.1 + 0.2 style: el motor usa decimal.js, no number.
      expect(q.total).toMatch(/^\d+\.\d{2}$/);
      expect(Number.isNaN(Number(q.total))).toBe(false);
    });
  });

  describe('validación / vectores de dinero negativo o inválido', () => {
    it('rechaza neto negativo', () => {
      expect(() => PricingEngine.quote(-100, DEFAULT)).toThrow(BadRequestException);
    });
    it('rechaza neto cero', () => {
      expect(() => PricingEngine.quote(0, DEFAULT)).toThrow(BadRequestException);
    });
    it('rechaza % de plataforma negativo', () => {
      expect(() => PricingEngine.quote(100, { ...DEFAULT, platformFeePct: -0.05 })).toThrow(
        BadRequestException,
      );
    });
    it('rechaza % de pasarela >= 1 (evita división por cero/negativa)', () => {
      expect(() => PricingEngine.quote(100, { ...DEFAULT, gatewayFeePct: 1 })).toThrow(
        BadRequestException,
      );
    });
    it('rechaza cargos fijos negativos', () => {
      expect(() => PricingEngine.quote(100, { ...DEFAULT, fixedFees: -10 })).toThrow(
        BadRequestException,
      );
    });
  });

  describe('pago en cuotas (Ola 6.5): comprador paga igual, la plataforma/promotor absorbe', () => {
    it('sin plan o count<=1 → resultado idéntico y SIN campos de cuotas (retrocompat)', () => {
      const base = PricingEngine.quote(100, DEFAULT);
      const one = PricingEngine.quote(100, DEFAULT, { count: 1, ratePct: 0.08 });
      expect(one.total).toBe('129.68');
      expect(one.installments).toBeUndefined();
      expect(one.installmentAbsorbedBy).toBeUndefined();
      expect(one.hash).toBe(base.hash); // hash retrocompatible
    });

    // Ola 6.6: el fijo por transacción (Q2) vive en los PARAMS de la pasarela y
    // aplica a TODO cobro (1 pago y cuotas). Sube el precio base de esa pasarela.
    const FIXED: FeeParams = { ...DEFAULT, transactionFixedFee: 2 };

    it('el fijo por transacción (Q2) aplica también al 1 pago: base sube a 131.79', () => {
      const q = PricingEngine.quote(100, FIXED);
      expect(q.total).toBe('131.79'); // (100 + 10 + 13.20 + 2) / 0.95
      expect(q.gatewayFee).toBe('8.59'); // 131.79*0.05 + 2
      expect(q.platformFee).toBe('10.00'); // plataforma intacta
      expect(q.iva).toBe('13.20');
      expect(q.net).toBe('100.00');
      expect(q.serviceFee).toBe('18.59'); // 10.00 + 8.59
    });

    it('plataforma absorbe (3 cuotas 8% + Q2): total/net/IVA intactos; gateway sube, platform baja', () => {
      const q = PricingEngine.quote(100, FIXED, { count: 3, ratePct: 0.08 });
      expect(q.total).toBe('131.79'); // el comprador paga IGUAL que el 1 pago de Recurrente
      expect(q.net).toBe('100.00'); //   promotor intacto
      expect(q.iva).toBe('13.20'); //    IVA intacto (no subdeclara impuestos)
      expect(q.gatewayFee).toBe('12.54'); // 131.79*0.08 + 2
      expect(q.platformFee).toBe('6.05'); //  10 − (12.54 − 8.59); el fijo se cancela
      expect(q.installments).toBe(3);
      expect(q.installmentFeePct).toBe(0.08);
      expect(q.installmentFixedFee).toBe('2.00');
      expect(q.installmentSurcharge).toBe('3.95'); // solo el %-extra (131.79*0.03)
      expect(q.installmentAbsorbedBy).toBe('platform');
      expect(q.basePrice).toBe('131.79');
      // Vista comprador ESTABLE: la cuota de servicio fusionada NO cambia con cuotas.
      expect(q.serviceFee).toBe('18.59'); // 6.05 (plataforma) + 12.54 (pasarela)
      expect(new Decimal(q.net).plus(q.serviceFee).plus(q.iva).toFixed(2)).toBe(q.total);
      // Invariante de partida doble.
      const sum = new Decimal(q.net).plus(q.platformFee).plus(q.iva).plus(q.gatewayFee).plus(q.fixedFees);
      expect(sum.toFixed(2)).toBe(q.total);
      expect(PricingEngine.verify(q)).toBe(true);
    });

    it('promotor absorbe: baja el NETO del promotor, plataforma intacta', () => {
      const q = PricingEngine.quote(100, FIXED, {
        count: 3,
        ratePct: 0.08,
        absorbedByPromoter: true,
      });
      expect(q.total).toBe('131.79');
      expect(q.net).toBe('96.05'); //     100 − 3.95
      expect(q.platformFee).toBe('10.00'); // plataforma intacta
      expect(q.iva).toBe('13.20');
      expect(q.gatewayFee).toBe('12.54');
      expect(q.installmentAbsorbedBy).toBe('promoter');
      const sum = new Decimal(q.net).plus(q.platformFee).plus(q.iva).plus(q.gatewayFee).plus(q.fixedFees);
      expect(sum.toFixed(2)).toBe(q.total);
    });

    it('sin cargo fijo (3 cuotas 8%): gateway=10.37, platform=6.11', () => {
      const q = PricingEngine.quote(100, DEFAULT, { count: 3, ratePct: 0.08 });
      expect(q.gatewayFee).toBe('10.37'); // 129.68*0.08
      expect(q.platformFee).toBe('6.11'); //  10 − (10.37 − 6.48)
      expect(q.installmentFixedFee).toBe('0.00');
    });

    it('18 cuotas (14% + Q2): la plataforma puede quedar con margen negativo (sin buffer)', () => {
      const q = PricingEngine.quote(100, FIXED, { count: 18, ratePct: 0.14 });
      expect(q.gatewayFee).toBe('20.45'); // 131.79*0.14 + 2
      expect(q.platformFee).toBe('-1.86'); // 10 − (20.45 − 8.59) (plataforma pierde)
      expect(q.total).toBe('131.79');
      expect(q.net).toBe('100.00');
    });

    it('promotor no puede absorber si el costo supera su neto → 400', () => {
      // net minúsculo: el %-extra de 18 cuotas sobre un total inflado por el fijo
      // (≈0.20) excede el neto (0.10) → no puede absorberlo.
      expect(() =>
        PricingEngine.quote(0.1, FIXED, {
          count: 18,
          ratePct: 0.14,
          absorbedByPromoter: true,
        }),
      ).toThrow(BadRequestException);
    });

    it('el hash cubre los campos de cuotas (detecta manipulación del desglose)', () => {
      const q = PricingEngine.quote(100, FIXED, { count: 3, ratePct: 0.08 });
      const tampered = { ...q, installmentSurcharge: '0.00' };
      expect(PricingEngine.verify(tampered)).toBe(false);
    });
  });

  describe('hash anti-manipulación', () => {
    it('verify() es true para un quote íntegro', () => {
      const q = PricingEngine.quote(100, DEFAULT);
      expect(PricingEngine.verify(q)).toBe(true);
    });
    it('verify() es false si se altera el total en memoria', () => {
      const q = PricingEngine.quote(100, DEFAULT);
      const tampered = { ...q, total: '1.00' };
      expect(PricingEngine.verify(tampered)).toBe(false);
    });
    it('mismos inputs producen el mismo hash (determinista)', () => {
      const a = PricingEngine.quote(100, DEFAULT);
      const b = PricingEngine.quote(100, DEFAULT);
      expect(a.hash).toBe(b.hash);
    });
  });
});
