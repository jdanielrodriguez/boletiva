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
  selected: '#6c5ce7',
  taken: '#555b66',
};

/**
 * Mapa de asientos con Konva/Canvas (hit-testing) — escalable a miles de nodos
 * (SVG/DOM colapsaría en móviles de gama baja). SOLO navegador: Konva se importa
 * dinámicamente dentro de afterNextRender, así no se ejecuta en SSR.
 */
@Component({
  selector: 'app-seat-map',
  template: '<div #host class="seat-map-host"></div>',
})
export class SeatMapComponent {
  readonly seats = input<SeatAvailabilityDto[]>([]);
  readonly selected = input<ReadonlySet<string>>(new Set<string>());
  readonly width = input(1000);
  readonly height = input(800);
  readonly seatToggle = output<string>();

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');

  private konva: typeof Konva | null = null;
  private stage: Konva.Stage | null = null;
  private layer: Konva.Layer | null = null;
  private circles = new Map<string, Konva.Circle>();

  constructor() {
    afterNextRender(async () => {
      this.konva = (await import('konva')).default;
      this.build();
      this.paint();
    });
    // Repinta cuando cambian los asientos o la selección (tras el primer render).
    effect(() => {
      this.seats();
      this.selected();
      if (this.stage) this.rebuild();
    });
  }

  private build(): void {
    if (!this.konva) return;
    this.stage = new this.konva.Stage({
      container: this.host().nativeElement,
      width: this.width(),
      height: this.height(),
    });
    this.layer = new this.konva.Layer();
    this.stage.add(this.layer);
    this.drawSeats();
  }

  private rebuild(): void {
    this.layer?.destroyChildren();
    this.circles.clear();
    this.drawSeats();
    this.paint();
  }

  private drawSeats(): void {
    if (!this.konva || !this.layer) return;
    for (const seat of this.seats()) {
      if (seat.x == null || seat.y == null) continue;
      const circle = new this.konva.Circle({
        x: seat.x,
        y: seat.y,
        radius: 8,
        stroke: '#1a1c22',
        strokeWidth: 1,
      });
      if (seat.status === 'available') {
        circle.on('click tap', () => this.seatToggle.emit(seat.id));
        circle.on('mouseenter', () => (this.stage!.container().style.cursor = 'pointer'));
        circle.on('mouseleave', () => (this.stage!.container().style.cursor = 'default'));
      }
      this.circles.set(seat.id, circle);
      this.layer.add(circle);
    }
    this.layer.draw();
  }

  private paint(): void {
    const sel = this.selected();
    for (const seat of this.seats()) {
      const circle = this.circles.get(seat.id);
      if (!circle) continue;
      const color =
        seat.status !== 'available' ? COLORS.taken : sel.has(seat.id) ? COLORS.selected : COLORS.available;
      circle.fill(color);
    }
    this.layer?.draw();
  }
}
