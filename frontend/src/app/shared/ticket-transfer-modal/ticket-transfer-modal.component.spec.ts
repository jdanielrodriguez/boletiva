import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { TicketsApi } from '../../core/api/tickets.api';
import { SITE_URL } from '../../core/config/api.tokens';
import { I18nService } from '../../core/i18n/i18n.service';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
import { ToastService } from '../../core/ui/toast.service';
import type { TransferInitiatedDto } from '../../core/api/types';
import { TicketTransferModal } from './ticket-transfer-modal.component';

describe('TicketTransferModal', () => {
  let fixture: ComponentFixture<TicketTransferModal>;
  let el: HTMLElement;
  let transfer: jasmine.Spy;

  async function setup(fail = false) {
    transfer = jasmine
      .createSpy('transfer')
      .and.returnValue(
        fail
          ? throwError(() => new Error('x'))
          : of({ transferId: 'tr1', code: 'K7MNPQ23', expiresAt: '2026-01-01T00:00:00Z' } as TransferInitiatedDto),
      );
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ...provideI18nTesting(),
        ToastService,
        { provide: TicketsApi, useValue: { transfer } },
        { provide: SITE_URL, useValue: 'http://localhost:4200' },
      ],
    });
    initI18nTesting();
    fixture = TestBed.createComponent(TicketTransferModal);
    fixture.componentRef.setInput('ticketId', 't1');
    fixture.componentRef.setInput('serial', 'PE-1');
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const click = (id: string) => {
    (el.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement).click();
    fixture.detectChanges();
  };

  it('arranca en el paso de instrucciones (no transfiere aún)', async () => {
    await setup();
    expect(el.querySelector('[data-testid="transfer-modal"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="transfer-confirm"]')).not.toBeNull();
    expect(transfer).not.toHaveBeenCalled();
  });

  it('confirmar transfiere y pasa a compartir el código', async () => {
    await setup();
    click('transfer-confirm');
    expect(transfer).toHaveBeenCalledWith('t1');
    expect(el.querySelector('[data-testid="transfer-code"]')?.textContent).toContain('K7MNPQ23');
    // Hint al destinatario visible.
    expect(el.querySelector('[data-testid="transfer-explain"]')).not.toBeNull();
  });

  it('error al iniciar la transferencia muestra mensaje y no cambia de paso', async () => {
    await setup(true);
    click('transfer-confirm');
    expect(el.querySelector('[data-testid="transfer-error"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="transfer-code"]')).toBeNull();
  });

  it('cancelar emite closed', async () => {
    await setup();
    let closed = false;
    fixture.componentInstance.closed.subscribe(() => (closed = true));
    click('transfer-cancel');
    expect(closed).toBe(true);
  });

  it('traduce al inglés', async () => {
    await setup();
    TestBed.inject(I18nService).use('en');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="transfer-confirm"]')?.textContent).toContain('transfer');
  });
});
