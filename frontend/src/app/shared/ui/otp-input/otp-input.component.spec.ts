import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideI18nTesting } from '../../../core/i18n/testing';
import { OtpInputComponent } from './otp-input.component';

describe('OtpInputComponent', () => {
  let fixture: ComponentFixture<OtpInputComponent>;
  let comp: OtpInputComponent;
  let el: HTMLElement;

  async function setup(length?: number): Promise<void> {
    TestBed.configureTestingModule({
      providers: [...provideI18nTesting(), provideZonelessChangeDetection()],
    });
    fixture = TestBed.createComponent(OtpInputComponent);
    comp = fixture.componentInstance;
    if (length !== undefined) fixture.componentRef.setInput('length', length);
    el = fixture.nativeElement as HTMLElement;
    // Adjunta al DOM para que el foco programático fije document.activeElement.
    document.body.appendChild(el);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => {
    el?.remove();
  });

  const box = (i: number) => el.querySelector(`[data-testid="otp-box-${i}"]`) as HTMLInputElement;

  function type(i: number, value: string): void {
    const input = box(i);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('renderiza N casillas según length (default 6)', async () => {
    await setup();
    expect(el.querySelectorAll('[data-testid="otp-input"] input').length).toBe(6);
  });

  it('respeta un length personalizado', async () => {
    await setup(4);
    expect(el.querySelectorAll('[data-testid="otp-input"] input').length).toBe(4);
  });

  it('escribir un dígito lo fija y autoavanza a la siguiente casilla', async () => {
    await setup();
    type(0, '1');
    expect(comp.value()).toBe('1');
    expect(document.activeElement).toBe(box(1));
    type(1, '2');
    expect(comp.value()).toBe('12');
    expect(document.activeElement).toBe(box(2));
  });

  it('Backspace en una casilla vacía retrocede y borra la anterior', async () => {
    await setup();
    type(0, '1'); // → foco en box 1
    box(1).dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    fixture.detectChanges();
    expect(comp.value()).toBe('');
    expect(document.activeElement).toBe(box(0));
  });

  it('pegar "123456" reparte dígito por dígito y emite el valor completo', async () => {
    await setup();
    const emitted: string[] = [];
    comp.value.subscribe((v) => emitted.push(v));
    const ev = new Event('paste') as Event & { clipboardData: { getData: () => string } };
    ev.clipboardData = { getData: () => '123456' };
    box(0).dispatchEvent(ev);
    fixture.detectChanges();
    expect(comp.value()).toBe('123456');
    expect(box(0).value).toBe('1');
    expect(box(5).value).toBe('6');
    expect(emitted.at(-1)).toBe('123456');
  });

  it('pegar un código completo en CUALQUIER casilla lo reparte desde el inicio', async () => {
    await setup();
    const ev = new Event('paste') as Event & { clipboardData: { getData: () => string } };
    ev.clipboardData = { getData: () => '654321' };
    box(3).dispatchEvent(ev);
    fixture.detectChanges();
    expect(comp.value()).toBe('654321');
  });

  it('ignora letras/espacios al pegar', async () => {
    await setup();
    const ev = new Event('paste') as Event & { clipboardData: { getData: () => string } };
    ev.clipboardData = { getData: () => '1a 2b 3c' };
    box(0).dispatchEvent(ev);
    fixture.detectChanges();
    expect(comp.value()).toBe('123');
  });

  it('ignora un carácter no numérico al teclear', async () => {
    await setup();
    type(0, 'x');
    expect(comp.value()).toBe('');
    expect(box(0).value).toBe('');
  });

  it('al pegar respeta el length (recorta el exceso)', async () => {
    await setup(4);
    const ev = new Event('paste') as Event & { clipboardData: { getData: () => string } };
    ev.clipboardData = { getData: () => '123456' };
    box(0).dispatchEvent(ev);
    fixture.detectChanges();
    expect(comp.value()).toBe('1234');
  });

  it('la primera casilla lleva autocomplete="one-time-code"', async () => {
    await setup();
    expect(box(0).getAttribute('autocomplete')).toBe('one-time-code');
    expect(box(1).getAttribute('autocomplete')).toBe('off');
  });
});
