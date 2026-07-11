import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LockChipComponent } from './lock-chip.component';

describe('LockChipComponent (v3.9 · A2)', () => {
  let fixture: ComponentFixture<LockChipComponent>;

  function setup(inputs: Partial<Record<string, unknown>> = {}) {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });
    fixture = TestBed.createComponent(LockChipComponent);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
  }

  it('cerrado: renderiza el candado icon-only con el data-testid y título dados', () => {
    setup({ closedTestid: 'gw-lock', closedTitle: 'Desbloquear' });
    const el = fixture.nativeElement as HTMLElement;
    const btn = el.querySelector('[data-testid="gw-lock"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.classList).toContain('lock-btn');
    expect(btn.classList).toContain('icon-only');
    expect(btn.getAttribute('title')).toBe('Desbloquear');
    expect(btn.getAttribute('aria-label')).toBe('Desbloquear');
    // Cerrado no muestra la pastilla abierta.
    expect(el.querySelector('.lock-chip-open')).toBeNull();
  });

  it('cerrado: al pulsar emite (unlock)', () => {
    setup({ closedTestid: 'unlock-btn' });
    const spy = jasmine.createSpy('unlock');
    fixture.componentInstance.unlock.subscribe(spy);
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="unlock-btn"]')!
      .click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('abierto: muestra la pastilla con la cuenta regresiva y su testid', () => {
    setup({ open: true, openTestid: 'unlock-timer', countdown: 'Desbloqueado · 04:59', openTitle: 'Abierto' });
    const el = fixture.nativeElement as HTMLElement;
    const chip = el.querySelector('[data-testid="unlock-timer"]');
    expect(chip).not.toBeNull();
    expect(chip!.classList).toContain('lock-chip-open');
    expect(el.querySelector('.lock-countdown')!.textContent).toContain('04:59');
    // Abierto no muestra el botón cerrado.
    expect(el.querySelector('.lock-btn')).toBeNull();
  });

  it('abierto sin countdown: no renderiza la etiqueta de tiempo', () => {
    setup({ open: true });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.lock-chip-open')).not.toBeNull();
    expect(el.querySelector('.lock-countdown')).toBeNull();
  });
});
