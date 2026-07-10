import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { OrdersApi } from '../../core/api/orders.api';
import { ToastService } from '../../core/ui/toast.service';
import type { OrderLedgerChainDto, OrderResponseDto } from '../../core/api/types';
import { TransactionDetail } from './transaction-detail';

const ORDER = {
  id: 'o1',
  eventId: 'ev1',
  event: { name: 'Fiesta', slug: 'fiesta', startsAt: '2028-01-01T00:00:00.000Z' },
  status: 'paid',
  currency: 'GTQ',
  net: '100.00',
  iva: '13.20',
  gatewayFee: '16.48',
  total: '129.68',
  billingNit: 'CF',
  items: [{ id: 'i1', localityId: 'l1', locality: { name: 'VIP' }, label: 'A-1', net: '100.00', total: '129.68' }],
} as unknown as OrderResponseDto;

const CHAIN = {
  orderId: 'o1',
  chainValid: true,
  transactions: [{ seq: 1, kind: 'payment', createdAt: '', hash: 'abcdef123456xyz', prevHash: '', verified: true }],
} as unknown as OrderLedgerChainDto;

describe('TransactionDetail', () => {
  let fixture: ComponentFixture<TransactionDetail>;
  let el: HTMLElement;
  let orders: jasmine.SpyObj<OrdersApi>;

  async function setup(opts: { fail?: boolean } = {}) {
    orders = jasmine.createSpyObj<OrdersApi>('OrdersApi', ['get', 'ledgerChain']);
    orders.get.and.returnValue(opts.fail ? throwError(() => new Error('404')) : of(ORDER));
    orders.ledgerChain.and.returnValue(of(CHAIN));

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: OrdersApi, useValue: orders },
        { provide: ToastService, useValue: { error: () => 0 } },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ orderId: 'o1' })) } },
      ],
    });
    fixture = TestBed.createComponent(TransactionDetail);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  it('muestra el detalle de la orden con ítems y total formateado', async () => {
    await setup();
    expect(el.querySelector('[data-testid="txn-card"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="txn-items"]')?.textContent).toContain('VIP');
    expect(el.querySelector('[data-testid="txn-total"]')?.textContent).toBe('Q129.68');
  });

  it('la cuota por servicio reconcilia (boleto + servicio + IVA = total), no solo gatewayFee', async () => {
    // net 150 + servicio 24.72 + IVA 19.80 = 194.52; gatewayFee (9.72) es SOLO una
    // parte → mostrarla sola no cuadraba (bug QA). Debe mostrar el fusionado 24.72.
    orders = jasmine.createSpyObj<OrdersApi>('OrdersApi', ['get', 'ledgerChain']);
    orders.get.and.returnValue(
      of({ ...ORDER, net: '150.00', iva: '19.80', gatewayFee: '9.72', total: '194.52' } as unknown as OrderResponseDto),
    );
    orders.ledgerChain.and.returnValue(of(CHAIN));
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: OrdersApi, useValue: orders },
        { provide: ToastService, useValue: { error: () => 0 } },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ orderId: 'o1' })) } },
      ],
    });
    const fx = TestBed.createComponent(TransactionDetail);
    fx.detectChanges();
    await fx.whenStable();
    fx.detectChanges();
    const node = fx.nativeElement as HTMLElement;
    expect(node.querySelector('[data-testid="txn-servicefee"]')?.textContent).toBe('Q24.72');
    expect(node.querySelector('[data-testid="txn-total"]')?.textContent).toBe('Q194.52');
  });

  it('carga y oculta la cadena blockchain bajo demanda', async () => {
    await setup();
    (el.querySelector('[data-testid="txn-toggle-chain"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(orders.ledgerChain).toHaveBeenCalledWith('o1');
    expect(el.querySelector('[data-testid="txn-chain"]')).not.toBeNull();
    (el.querySelector('[data-testid="txn-toggle-chain"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="txn-chain"]')).toBeNull();
  });

  it('orden inexistente → mensaje de no encontrada', async () => {
    await setup({ fail: true });
    expect(el.querySelector('[data-testid="txn-notfound"]')).not.toBeNull();
  });
});
