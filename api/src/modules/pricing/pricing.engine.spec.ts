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
