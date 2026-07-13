import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
import { SearchFieldComponent } from './search-field.component';

/** Host que ejercita el two-way (valueChange) y el disparo explícito (searched). */
@Component({
  imports: [SearchFieldComponent],
  template: `<app-search-field
    [value]="val()"
    (valueChange)="onChange($event)"
    (searched)="onSearch($event)"
    testId="q"
  />`,
})
class HostComponent {
  readonly val = signal('');
  readonly changes: string[] = [];
  readonly searches: string[] = [];
  onChange(v: string): void {
    this.changes.push(v);
    this.val.set(v);
  }
  onSearch(v: string): void {
    this.searches.push(v);
  }
}

describe('SearchFieldComponent (v3.10 · GIII)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;

  async function setup(): Promise<void> {
    TestBed.configureTestingModule({
      providers: [...provideI18nTesting(), provideZonelessChangeDetection()],
    });
    initI18nTesting();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  it('propaga el data-testid al input y renderiza la lupita dentro del field', async () => {
    await setup();
    const input = el.querySelector('input[data-testid="q"]');
    const btn = el.querySelector('.search-field-btn[data-testid="q-btn"]');
    expect(input).not.toBeNull();
    expect(btn).not.toBeNull();
    expect(el.querySelector('.search-field svg')).not.toBeNull();
  });

  it('cada tecla emite valueChange (filtros reactivos)', async () => {
    await setup();
    const input = el.querySelector('input[data-testid="q"]') as HTMLInputElement;
    input.value = 'foo';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(host.changes.at(-1)).toBe('foo');
  });

  it('la lupita emite searched con el valor actual', async () => {
    await setup();
    const input = el.querySelector('input[data-testid="q"]') as HTMLInputElement;
    input.value = 'concierto';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    const btn = el.querySelector('.search-field-btn') as HTMLButtonElement;
    btn.click();
    expect(host.searches.at(-1)).toBe('concierto');
  });

  it('Enter en el input también emite searched', async () => {
    await setup();
    const input = el.querySelector('input[data-testid="q"]') as HTMLInputElement;
    input.value = 'teatro';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(host.searches.at(-1)).toBe('teatro');
  });
});
