import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideI18nTesting } from '../../core/i18n/testing';
import type { ReservationItemDto } from '../../core/api/types';
import { ReservationItems } from './reservation-items.component';

const ITEMS = [
  { seatId: 'v1', label: '5', section: null, row: 'A', localityId: 'vip', localityName: 'VIP', price: { currency: 'GTQ', net: '100.00', serviceFee: '16.48', iva: '13.20', total: '129.68' } },
  { seatId: 'v2', label: '3', section: 'Mesa 2', row: null, localityId: 'vip', localityName: 'VIP', price: { currency: 'GTQ', net: '100.00', serviceFee: '16.48', iva: '13.20', total: '129.68' } },
  { seatId: 'g1', label: 'GA-1', section: null, row: null, localityId: 'ga', localityName: 'General', price: { currency: 'GTQ', net: '75.00', serviceFee: '12.36', iva: '9.90', total: '97.26' } },
] as unknown as ReservationItemDto[];

describe('ReservationItems (ficha técnica)', () => {
  let fixture: ComponentFixture<ReservationItems>;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [
        ...provideI18nTesting(),
        ...provideI18nTesting(),provideZonelessChangeDetection()] });
    fixture = TestBed.createComponent(ReservationItems);
    fixture.componentRef.setInput('items', ITEMS);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  });

  it('agrupa por localidad (VIP y General)', () => {
    const groups = el.querySelectorAll('.res-group');
    expect(groups.length).toBe(2);
    expect(el.textContent).toContain('VIP');
    expect(el.textContent).toContain('General');
  });

  it('describe asiento numerado con fila y mesa', () => {
    const text = el.querySelector('.res-group')?.textContent ?? '';
    expect(text).toContain('Fila A · Asiento 5');
    expect(text).toContain('Mesa 2 · Asiento 3');
  });

  it('el cupo GA muestra su código sin fila/asiento', () => {
    expect(el.textContent).toContain('GA-1');
    expect(el.textContent).not.toContain('Asiento GA-1');
  });

  it('calcula subtotal por localidad', () => {
    const subtotals = [...el.querySelectorAll('.res-subtotal')].map((n) => n.textContent);
    expect(subtotals.some((s) => s?.includes('259.36'))).toBe(true); // 2 × 129.68 VIP
    expect(subtotals.some((s) => s?.includes('97.26'))).toBe(true); // 1 × General
  });

  it('sin muchos boletos NO muestra el paginador', () => {
    expect(el.querySelector('[data-testid="reservation-items-pager"]')).toBeNull();
  });

  it('con muchos boletos pagina la lista y conserva el subtotal total de la localidad', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      seatId: `g${i}`,
      label: `GA-${i + 1}`,
      section: null,
      row: null,
      localityId: 'ga',
      localityName: 'General',
      price: { currency: 'GTQ', net: '75.00', serviceFee: '12.36', iva: '9.90', total: '100.00' },
    })) as unknown as ReservationItemDto[];
    fixture.componentRef.setInput('items', many);
    fixture.componentRef.setInput('pageSize', 10);
    fixture.detectChanges();
    // Solo 10 filas visibles en la 1.ª página.
    expect(el.querySelectorAll('.res-group li').length).toBe(10);
    // Paginador presente.
    expect(el.querySelector('[data-testid="reservation-items-pager"]')).not.toBeNull();
    // El subtotal refleja los 15 boletos (15 × 100 = 1500) con formato de moneda
    // (MoneyPipe → separador de miles), no solo la página.
    expect(el.querySelector('.res-subtotal')?.textContent).toContain('1,500.00');
  });
});
