import { Directive, ElementRef, inject } from '@angular/core';

/**
 * Arrastrar-para-scrollear horizontal (desktop + móvil) en un contenedor con
 * overflow-x. En móvil el touch ya scrollea nativo; esto añade el drag con mouse en
 * desktop (agarrar y arrastrar los pills). Un clic normal (sin arrastre) sigue
 * funcionando: solo se considera "drag" si el puntero se mueve > 4px.
 */
@Directive({
  selector: '[appDragScroll]',
  host: {
    '(pointerdown)': 'onDown($event)',
    '(pointermove)': 'onMove($event)',
    '(pointerup)': 'onUp()',
    '(pointerleave)': 'onUp()',
    '(dragstart)': '$event.preventDefault()',
    '(wheel)': 'onWheel($event)',
  },
})
export class DragScrollDirective {
  private readonly el = inject(ElementRef<HTMLElement>).nativeElement;
  private down = false;
  private moved = false;
  private startX = 0;
  private startScroll = 0;

  protected onDown(e: PointerEvent): void {
    // Solo con puntero de ratón/pluma; el táctil usa el scroll nativo.
    if (e.pointerType === 'touch') return;
    this.down = true;
    this.moved = false;
    this.startX = e.clientX;
    this.startScroll = this.el.scrollLeft;
    this.el.style.cursor = 'grabbing';
  }

  protected onMove(e: PointerEvent): void {
    if (!this.down) return;
    const dx = e.clientX - this.startX;
    if (Math.abs(dx) > 4) this.moved = true;
    this.el.scrollLeft = this.startScroll - dx;
  }

  /**
   * Rueda del ratón sobre el carril → scroll HORIZONTAL. Al llegar a un extremo (izq/der)
   * NO capturamos la rueda → la página sigue con su scroll vertical normal.
   */
  protected onWheel(e: WheelEvent): void {
    const el = this.el;
    if (el.scrollWidth <= el.clientWidth) return; // no hay overflow → scroll normal
    const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (delta === 0) return;
    const max = el.scrollWidth - el.clientWidth;
    const atStart = el.scrollLeft <= 1;
    const atEnd = el.scrollLeft >= max - 1;
    // En un extremo y siguiendo en esa dirección → NO capturamos: la página hace su scroll
    // vertical normal (arriba en el inicio, abajo al final del carril).
    if ((delta < 0 && atStart) || (delta > 0 && atEnd)) return;
    el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + delta));
    e.preventDefault();
  }

  protected onUp(): void {
    if (!this.down) return;
    this.down = false;
    this.el.style.cursor = 'grab';
    // Si hubo arrastre real, evita que el "click" active un pill sin querer.
    if (this.moved) {
      const cancel = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
        this.el.removeEventListener('click', cancel, true);
      };
      this.el.addEventListener('click', cancel, true);
      setTimeout(() => this.el.removeEventListener('click', cancel, true), 0);
    }
  }
}
