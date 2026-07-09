import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { TransfersApi } from '../../core/api/transfers.api';
import { TransferClaim } from './transfer-claim';

describe('TransferClaim (reclamar boleto)', () => {
  let fixture: ComponentFixture<TransferClaim>;
  let el: HTMLElement;

  async function setup(claim: jasmine.Spy) {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: TransfersApi, useValue: { claim } },
      ],
    });
    fixture = TestBed.createComponent(TransferClaim);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const submit = () => {
    (el.querySelector('[data-testid="claim-submit"]') as HTMLButtonElement).click();
    fixture.detectChanges();
  };

  it('sin código muestra error y no llama al API', async () => {
    const claim = jasmine.createSpy('claim');
    await setup(claim);
    submit();
    expect(claim).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="claim-error"]')).not.toBeNull();
  });

  it('con código válido canjea y muestra el serial', async () => {
    const claim = jasmine.createSpy('claim').and.returnValue(of({ serial: 'PE7K3M9Q', status: 'valid' }));
    await setup(claim);
    fixture.componentInstance['code'].set('ABC123');
    submit();
    expect(claim).toHaveBeenCalledWith('ABC123');
    expect(el.querySelector('[data-testid="claim-ok"]')?.textContent).toContain('PE7K3M9Q');
  });

  it('código inválido muestra error', async () => {
    const claim = jasmine.createSpy('claim').and.returnValue(throwError(() => new Error('404')));
    await setup(claim);
    fixture.componentInstance['code'].set('BAD');
    submit();
    expect(el.querySelector('[data-testid="claim-error"]')).not.toBeNull();
  });

  it('tras canjear, ver mis boletos navega a /cuenta', async () => {
    const claim = jasmine.createSpy('claim').and.returnValue(of({ serial: 'PE1', status: 'valid' }));
    await setup(claim);
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate').and.resolveTo(true);
    fixture.componentInstance['code'].set('OK');
    submit();
    (el.querySelector('.claim-ok button') as HTMLButtonElement).click();
    expect(navSpy).toHaveBeenCalled();
    expect(navSpy.calls.mostRecent().args[0]).toEqual(['/cuenta']);
  });
});
