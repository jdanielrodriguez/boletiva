import { provideHttpClient } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AuditApi } from '../../core/api/audit.api';
import { TicketsApi } from '../../core/api/tickets.api';
import type { TransferInitiatedDto } from '../../core/api/types';
import { SITE_URL } from '../../core/config/api.tokens';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
import { ToastService } from '../../core/ui/toast.service';
import { TicketTransferModal } from './ticket-transfer-modal.component';

/** Interfaz mínima de los miembros protegidos que ejercitamos directamente. */
interface Testable {
  copy(): Promise<void>;
  onSendEmail(ev: Event): void;
  mailtoHref(): string;
  email: { set(v: string): void };
  copied(): boolean;
  step(): string;
}

describe('TicketTransferModal — auditoría, compartir y utilidades', () => {
  let fixture: ComponentFixture<TicketTransferModal>;
  let el: HTMLElement;
  let transfer: jasmine.Spy;
  let auditConfirm: jasmine.Spy;

  async function setup(auditFails = false): Promise<void> {
    transfer = jasmine.createSpy('transfer').and.returnValue(
      of({ transferId: 'tr1', code: 'ABCD12', expiresAt: '2026-01-01T00:00:00Z' } as TransferInitiatedDto),
    );
    auditConfirm = jasmine
      .createSpy('confirm')
      .and.returnValue(auditFails ? throwError(() => new Error('audit')) : of({ message: 'ok' }));
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        ...provideI18nTesting(),
        ToastService,
        { provide: TicketsApi, useValue: { transfer } },
        { provide: AuditApi, useValue: { confirm: auditConfirm } },
        { provide: SITE_URL, useValue: 'http://localhost:4200' },
      ],
    });
    initI18nTesting();
    fixture = TestBed.createComponent(TicketTransferModal);
    fixture.componentRef.setInput('ticketId', 't9');
    fixture.componentRef.setInput('serial', 'PE-9');
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const click = (id: string): void => {
    (el.querySelector(`[data-testid="${id}"]`) as HTMLElement).click();
    fixture.detectChanges();
  };
  const instance = (): Testable => fixture.componentInstance as unknown as Testable;

  it('confirmar registra el click en auditoría (no-repudio) con action+recurso', async () => {
    await setup();
    click('transfer-confirm');
    expect(auditConfirm).toHaveBeenCalledWith('ticket.transfer', 't9');
    expect(transfer).toHaveBeenCalledWith('t9');
  });

  it('un fallo de auditoría NO bloquea la transferencia (fire-and-forget)', async () => {
    await setup(true);
    click('transfer-confirm');
    // La transferencia igual pasó al paso de compartir.
    expect(el.querySelector('[data-testid="transfer-code"]')?.textContent).toContain('ABCD12');
  });

  it('el botón "entendido" del paso compartir emite closed', async () => {
    await setup();
    click('transfer-confirm');
    let closed = false;
    fixture.componentInstance.closed.subscribe(() => (closed = true));
    click('transfer-done');
    expect(closed).toBe(true);
  });

  // Instala un `navigator.clipboard.writeText` fresco (evita chocar con otros
  // specs que reemplazan el clipboard globalmente → sin dependencia de orden).
  const stubClipboard = (writeText: jasmine.Spy): void => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  };

  it('copy() escribe el código al portapapeles y marca copiado', async () => {
    await setup();
    click('transfer-confirm');
    const writeText = jasmine.createSpy('writeText').and.resolveTo();
    stubClipboard(writeText);
    await instance().copy();
    expect(writeText).toHaveBeenCalledWith('ABCD12');
    expect(instance().copied()).toBe(true);
  });

  it('copy() con portapapeles bloqueado no marca copiado y no lanza', async () => {
    await setup();
    click('transfer-confirm');
    stubClipboard(jasmine.createSpy('writeText').and.rejectWith(new Error('denied')));
    await instance().copy();
    expect(instance().copied()).toBe(false);
  });

  it('mailtoHref incluye el código y el link de canje; se actualiza con el email', async () => {
    await setup();
    click('transfer-confirm');
    instance().email.set('amiga@example.com');
    fixture.detectChanges();
    const href = instance().mailtoHref();
    expect(href.startsWith('mailto:')).toBe(true);
    expect(href).toContain(encodeURIComponent('amiga@example.com'));
    expect(href).toContain('ABCD12');
    expect(href).toContain(encodeURIComponent('/transferencias/reclamar'));
  });

  it('onSendEmail previene el mailto si no hay correo escrito', async () => {
    await setup();
    click('transfer-confirm');
    const ev = new Event('click');
    const prevent = spyOn(ev, 'preventDefault');
    instance().onSendEmail(ev); // email vacío
    expect(prevent).toHaveBeenCalled();

    instance().email.set('x@y.com');
    const ev2 = new Event('click');
    const prevent2 = spyOn(ev2, 'preventDefault');
    instance().onSendEmail(ev2);
    expect(prevent2).not.toHaveBeenCalled();
  });
});
