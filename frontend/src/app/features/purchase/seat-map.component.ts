import {
  Component,
  ElementRef,
  afterNextRender,
  effect,
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
})
export class SeatMapComponent {
  readonly seats = input<SeatAvailabilityDto[]>([]);
  readonly selected = input<ReadonlySet<string>>(new Set<string>());
  readonly seatToggle = output<string>();

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');

  private konva: typeof Konva | null = null;
  private stage: Konva.Stage | null = null;
  private layer: Konva.Layer | null = null;

  constructor() {
    afterNextRender(async () => {
      this.konva = (await import('konva')).default;
      this.build();
    });
    effect(() => {
      this.seats();
      this.selected();
      if (this.stage) this.rebuild();
    });
  }

  private build(): void {
    if (!this.konva) return;
    const { width, height } = this.extents();
    this.stage = new this.konva.Stage({ container: this.host().nativeElement, width, height });
    this.layer = new this.konva.Layer();
    this.stage.add(this.layer);
    this.drawSeats();
  }

  private rebuild(): void {
    if (!this.konva || !this.stage) return;
    const { width, height } = this.extents();
    this.stage.size({ width, height });
    this.layer?.destroyChildren();
    this.drawSeats();
  }

  /** Ajusta el lienzo al contenido (evita canvas enorme con espacio vacío). */
  private extents(): { width: number; height: number } {
    const pts = this.seats().filter((s) => s.x != null && s.y != null);
    if (pts.length === 0) return { width: 320, height: 160 };
    const maxX = Math.max(...pts.map((s) => s.x as number));
    const maxY = Math.max(...pts.map((s) => s.y as number));
    return { width: maxX + PAD, height: maxY + PAD };
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

      const g = new K.Group({ x: seat.x, y: seat.y });
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
