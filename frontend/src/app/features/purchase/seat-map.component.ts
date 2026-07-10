import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import type Konva from 'konva';
import type { SeatAvailabilityDto } from '../../core/api/types';

const COLORS = {
  available: '#2ecc71',
  selected: '#7b5cff',
  taken: '#3a3f52',
};
const PAD = 40;

/**
 * Mapa de asientos con Konva/Canvas: dibuja SILLITAS (no puntos) coloreadas por
 * estado, con un icono ✓ al seleccionar y × cuando están ocupadas. El cursor es
 * pointer SOLO sobre asientos disponibles; los ocupados no cambian el cursor ni
 * son clicables. Solo navegador (Konva se importa dinámicamente en afterNextRender).
 */
@Component({
  selector: 'app-seat-map',
  template: '<div #host class="seat-map-host"></div>',
  styles: [
    // El CANVAS ocupa el 100% del ancho del contenedor; el CONTENIDO (los asientos)
    // se centra dentro del stage vía offset del layer (no con CSS del canvas).
    ':host { display: block; width: 100%; }',
    '.seat-map-host { display: block; width: 100%; }',
  ],
})
export class SeatMapComponent {
  readonly seats = input<SeatAvailabilityDto[]>([]);
  readonly selected = input<ReadonlySet<string>>(new Set<string>());
  readonly seatToggle = output<string>();

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');

  private konva: typeof Konva | null = null;
  private stage: Konva.Stage | null = null;
  private layer: Konva.Layer | null = null;
  private offsetX = 0;
  private offsetY = 0;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    afterNextRender(async () => {
      this.konva = (await import('konva')).default;
      this.build();
      // Reajusta el ancho del stage al del contenedor cuando cambia (responsive).
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => this.rebuild());
        this.resizeObserver.observe(this.host().nativeElement);
      }
    });
    inject(DestroyRef).onDestroy(() => this.resizeObserver?.disconnect());
    effect(() => {
      this.seats();
      this.selected();
      if (this.stage) this.rebuild();
    });
  }

  private build(): void {
    if (!this.konva) return;
    const { width, height, offsetX, offsetY } = this.extents();
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    this.stage = new this.konva.Stage({ container: this.host().nativeElement, width, height });
    this.layer = new this.konva.Layer();
    this.stage.add(this.layer);
    this.drawSeats();
  }

  private rebuild(): void {
    if (!this.konva || !this.stage) return;
    const { width, height, offsetX, offsetY } = this.extents();
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    this.stage.size({ width, height });
    this.layer?.destroyChildren();
    this.drawSeats();
  }

  /** Ancho disponible del contenedor (para que el stage ocupe el 100%). */
  private containerWidth(): number {
    const el = this.host().nativeElement;
    return el.clientWidth || el.parentElement?.clientWidth || 320;
  }

  /**
   * El STAGE ocupa el ancho del contenedor (mínimo, el del contenido). El OFFSET
   * normaliza el origen del contenido a (PAD, PAD) y además lo CENTRA
   * horizontalmente dentro del stage (margen sobrante repartido a ambos lados) →
   * el canvas llena el ancho y los asientos quedan centrados.
   */
  private extents(): { width: number; height: number; offsetX: number; offsetY: number } {
    const pts = this.seats().filter((s) => s.x != null && s.y != null);
    const containerW = this.containerWidth();
    if (pts.length === 0) {
      return { width: containerW, height: 160, offsetX: 0, offsetY: 0 };
    }
    const xs = pts.map((s) => s.x as number);
    const ys = pts.map((s) => s.y as number);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    const contentWidth = maxX - minX + PAD * 2;
    const stageWidth = Math.max(contentWidth, containerW);
    const centerExtra = Math.max(0, (stageWidth - contentWidth) / 2);
    return {
      width: stageWidth,
      height: maxY - minY + PAD * 2,
      offsetX: PAD - minX + centerExtra,
      offsetY: PAD - minY,
    };
  }

  private drawSeats(): void {
    if (!this.konva || !this.layer) return;
    const K = this.konva;
    const sel = this.selected();

    for (const seat of this.seats()) {
      if (seat.x == null || seat.y == null) continue;
      const taken = seat.status !== 'available';
      const chosen = sel.has(seat.id);
      const color = taken ? COLORS.taken : chosen ? COLORS.selected : COLORS.available;

      const g = new K.Group({ x: (seat.x as number) + this.offsetX, y: (seat.y as number) + this.offsetY });
      // Respaldo + asiento (sillita).
      g.add(new K.Rect({ x: -11, y: -16, width: 22, height: 6, cornerRadius: 3, fill: color }));
      g.add(new K.Rect({ x: -13, y: -8, width: 26, height: 16, cornerRadius: 5, fill: color }));

      if (chosen && !taken) {
        g.add(this.icon(K, '✓', '#ffffff'));
      } else if (taken) {
        g.add(this.icon(K, '×', '#9aa0b0'));
      }

      if (!taken) {
        g.on('click tap', () => this.seatToggle.emit(seat.id));
        g.on('mouseenter', () => this.setCursor('pointer'));
        g.on('mouseleave', () => this.setCursor('default'));
      }
      this.layer.add(g);
    }
    this.layer.draw();
  }

  private icon(K: typeof Konva, text: string, fill: string): Konva.Text {
    return new K.Text({
      text,
      x: -13,
      y: -8,
      width: 26,
      height: 16,
      align: 'center',
      verticalAlign: 'middle',
      fontSize: 13,
      fontStyle: 'bold',
      fill,
      listening: false,
    });
  }

  private setCursor(value: string): void {
    if (this.stage) this.stage.container().style.cursor = value;
  }
}
