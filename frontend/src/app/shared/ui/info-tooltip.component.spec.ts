import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InfoTooltipComponent } from './info-tooltip.component';

describe('InfoTooltipComponent (v3.8)', () => {
  let fixture: ComponentFixture<InfoTooltipComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });
    fixture = TestBed.createComponent(InfoTooltipComponent);
    fixture.componentRef.setInput('detail', 'Explica qué hace este ajuste.');
    fixture.componentRef.setInput('heading', 'Comisión');
    fixture.componentRef.setInput('meta', 'Tipo: pct');
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  });

  it('el popover está oculto hasta pulsar el botón (i)', () => {
    expect(el.querySelector('[data-testid="info-tooltip-pop"]')).toBeNull();
    (el.querySelector('[data-testid="info-tooltip-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const pop = el.querySelector('[data-testid="info-tooltip-pop"]');
    expect(pop).not.toBeNull();
    expect(pop?.textContent).toContain('Explica qué hace');
    expect(pop?.textContent).toContain('Comisión');
    expect(pop?.textContent).toContain('Tipo: pct');
  });

  it('un segundo click lo cierra (toggle)', () => {
    const btn = el.querySelector('[data-testid="info-tooltip-btn"]') as HTMLButtonElement;
    btn.click();
    fixture.detectChanges();
    btn.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="info-tooltip-pop"]')).toBeNull();
  });

  it('un click fuera lo cierra', () => {
    (el.querySelector('[data-testid="info-tooltip-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    document.body.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="info-tooltip-pop"]')).toBeNull();
  });
});
