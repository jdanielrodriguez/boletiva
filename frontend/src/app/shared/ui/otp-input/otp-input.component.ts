import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  model,
  untracked,
  viewChildren,
} from '@angular/core';

/**
 * Input de CÓDIGO OTP por dígito (reutilizable). Muestra N casillas de un solo
 * dígito: escribir autoavanza, Backspace en vacía retrocede, y pegar el código
 * completo (p.ej. copiar "123456") lo reparte dígito por dígito. Solo dígitos.
 *
 * ZONELESS + signals. API pública:
 *   - `value` (model, two-way) / `(valueChange)`: el código concatenado.
 *   - `length` (default 6): número de casillas.
 *   - `disabled`: bloquea la edición.
 *
 * Accesible: `autocomplete="one-time-code"` en la 1.ª casilla + aria-label por
 * casilla. `data-testid="otp-input"` en el contenedor y `otp-box-<i>` por casilla.
 */
@Component({
  selector: 'app-otp-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .otp-input {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .otp-box {
        width: 3rem;
        max-width: 3rem;
        height: 3.25rem;
        text-align: center;
        font-size: 1.4rem;
        font-weight: 600;
        border: 1px solid var(--pe-border, #ccc);
        border-radius: 0.6rem;
        background: var(--pe-surface, #fff);
        color: var(--pe-text, inherit);
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .otp-box:focus {
        outline: none;
        border-color: var(--pe-accent, #a23ec8);
        box-shadow: 0 0 0 3px var(--pe-accent-soft, rgba(162, 62, 200, 0.25));
      }
      .otp-box:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    `,
  ],
  template: `
    <div class="otp-input" data-testid="otp-input" role="group" aria-label="Código de verificación">
      @for (i of indexes(); track i) {
        <input
          #box
          class="otp-box"
          type="text"
          inputmode="numeric"
          [attr.autocomplete]="i === 0 ? 'one-time-code' : 'off'"
          [attr.aria-label]="'Dígito ' + (i + 1) + ' de ' + length()"
          [attr.data-testid]="'otp-box-' + i"
          maxlength="1"
          [disabled]="disabled()"
          [value]="boxAt(i)"
          (input)="onInput(i, $event)"
          (keydown)="onKeydown(i, $event)"
          (paste)="onPaste(i, $event)"
          (focus)="onFocus($event)"
        />
      }
    </div>
  `,
})
export class OtpInputComponent {
  /** Longitud del código (número de casillas). */
  readonly length = input(6);
  /** Deshabilita la edición (p.ej. mientras se verifica). */
  readonly disabled = input(false);
  /** Código concatenado (two-way: `[value]` + `(valueChange)`). */
  readonly value = model('');

  /** Casillas: una posición por dígito (cadenas de 0–1 dígito). */
  protected readonly boxes = model<string[]>([]);

  private readonly boxEls = viewChildren<ElementRef<HTMLInputElement>>('box');

  constructor() {
    // Sincroniza el valor EXTERNO → casillas (sin bucle: solo escribe si difiere de
    // lo ya mostrado, y las casillas se leen con untracked). Cubre resets del padre
    // (p.ej. `code.set('')`) y cambios de `length`.
    effect(() => {
      const len = this.length();
      const clean = (this.value() ?? '').replace(/\D/g, '').slice(0, len);
      const current = untracked(this.boxes).join('');
      if (clean !== current) {
        this.boxes.set(Array.from({ length: len }, (_, i) => clean[i] ?? ''));
      }
    });
  }

  /** Índices [0..length) para el @for. */
  protected indexes(): number[] {
    return Array.from({ length: this.length() }, (_, i) => i);
  }

  /** Valor mostrado de la casilla `i` (cadena vacía si aún no inicializada). */
  protected boxAt(i: number): string {
    return this.boxes()[i] ?? '';
  }

  protected onInput(i: number, event: Event): void {
    const el = event.target as HTMLInputElement;
    const raw = el.value.replace(/\D/g, '');
    if (raw.length <= 1) {
      this.setBox(i, raw);
      // Restaura el valor mostrado (por si tecleó una letra: el binding no cambia).
      el.value = raw;
      if (raw.length === 1) this.focusBox(i + 1);
    } else {
      // Pegado/relleno rápido dentro de una casilla: reparte desde aquí.
      this.fillFrom(i, raw);
    }
  }

  protected onKeydown(i: number, event: KeyboardEvent): void {
    if (event.key === 'Backspace' && !(this.boxes()[i] ?? '')) {
      // Casilla vacía: retrocede y borra la anterior.
      event.preventDefault();
      if (i > 0) {
        this.setBox(i - 1, '');
        this.focusBox(i - 1);
      }
    }
  }

  protected onPaste(i: number, event: ClipboardEvent): void {
    event.preventDefault();
    const text = event.clipboardData?.getData('text') ?? '';
    const digits = text.replace(/\D/g, '');
    if (!digits) return;
    // Un código completo pegado en CUALQUIER casilla se reparte desde el inicio;
    // un fragmento continúa desde la casilla donde se pegó.
    const start = digits.length >= this.length() ? 0 : i;
    this.fillFrom(start, digits);
  }

  protected onFocus(event: FocusEvent): void {
    // Selecciona el contenido para que teclear reemplace (mejor UX en casillas llenas).
    (event.target as HTMLInputElement).select();
  }

  /** Fija una casilla y emite el valor concatenado. */
  private setBox(i: number, digit: string): void {
    this.boxes.update((arr) => {
      const next = [...arr];
      next[i] = digit;
      return next;
    });
    this.emit();
  }

  /** Reparte `digits` dígito por dígito desde `start`, enfoca la última llena. */
  private fillFrom(start: number, digits: string): void {
    const len = this.length();
    this.boxes.update((arr) => {
      const next = [...arr];
      let idx = start;
      for (const ch of digits) {
        if (idx >= len) break;
        next[idx++] = ch;
      }
      return next;
    });
    this.emit();
    this.focusBox(Math.min(start + digits.length, len - 1));
  }

  private emit(): void {
    this.value.set(this.boxes().join(''));
  }

  private focusBox(i: number): void {
    const els = this.boxEls();
    const el = els[i]?.nativeElement;
    if (el) {
      el.focus();
      el.select();
    }
  }
}
