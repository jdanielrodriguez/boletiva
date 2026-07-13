import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SwitchComponent } from './switch.component';

/** Host que ejercita el patrón [checked] / (checkedChange). */
@Component({
  imports: [SwitchComponent],
  template: `<app-switch
    [checked]="on()"
    [label]="label()"
    [disabled]="disabled()"
    testId="sw"
    (checkedChange)="onChange($event)"
  />`,
})
class HostComponent {
  readonly on = signal(false);
  readonly label = signal('Activar');
  readonly disabled = signal(false);
  readonly changes: boolean[] = [];
  onChange(v: boolean): void {
    this.changes.push(v);
    this.on.set(v);
  }
}

describe('SwitchComponent (v3.10 · GI)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;

  async function setup(): Promise<void> {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  function btn(): HTMLButtonElement {
    return el.querySelector('button[role="switch"]') as HTMLButtonElement;
  }

  it('renderiza role=switch con aria-checked y la etiqueta', async () => {
    await setup();
    expect(btn()).not.toBeNull();
    expect(btn().getAttribute('aria-checked')).toBe('false');
    expect(el.textContent).toContain('Activar');
    expect(el.querySelector('button[data-testid="sw"]')).not.toBeNull();
  });

  it('al pulsar emite checkedChange con el valor invertido', async () => {
    await setup();
    btn().click();
    await fixture.whenStable();
    expect(host.changes.at(-1)).toBe(true);
    fixture.detectChanges();
    expect(btn().getAttribute('aria-checked')).toBe('true');
    btn().click();
    await fixture.whenStable();
    expect(host.changes.at(-1)).toBe(false);
  });

  it('deshabilitado no emite ni permite el click', async () => {
    await setup();
    host.disabled.set(true);
    fixture.detectChanges();
    expect(btn().disabled).toBe(true);
    btn().click();
    await fixture.whenStable();
    expect(host.changes.length).toBe(0);
  });
});
